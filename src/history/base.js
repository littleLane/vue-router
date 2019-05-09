/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'

export class History {
  router: Router;
  base: string;
  current: Route;
  pending: ?Route;
  cb: (r: Route) => void;
  ready: boolean;
  readyCbs: Array<Function>;
  readyErrorCbs: Array<Function>;
  errorCbs: Array<Function>;

  // implemented by sub-classes
  // 前面的 ➕ 代表 read-only
  // 前面还可以是 ➖ 代表 write-only
  // https://flow.org/en/docs/types/interfaces/#toc-interface-property-variance-read-only-and-write-only
  +go: (n: number) => void;
  +push: (loc: RawLocation) => void;
  +replace: (loc: RawLocation) => void;
  +ensureURL: (push?: boolean) => void;
  +getCurrentLocation: () => string;

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
  }

  listen (cb: Function) {
    this.cb = cb
  }

  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  // 处理路由变化中的基础逻辑
  // 参数 location：是目标的路径
  // 参数 onComplete：是路由切换完成后的回调
  // 参数 onAbort：是路由切换失败后的回调
  transitionTo (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // 调用 match 得到匹配的 route 对象
    const route = this.router.match(location, this.current)

    // 确认过度
    this.confirmTransition(route, () => {
      // 实质的路由切换，更新当前的 route 对象
      this.updateRoute(route)
      onComplete && onComplete(route)

      // 子类实现的更新 url 地址
      // 对于 hash 模式的话 就是更新 hash 的值
      // 对于 history 模式的话 就是利用 pushstate / replacestate 来更新浏览器地址
      this.ensureURL()

      // fire ready cbs once
      if (!this.ready) {
        this.ready = true
        this.readyCbs.forEach(cb => { cb(route) })
      }
    }, err => {
      if (onAbort) {
        onAbort(err)
      }
      if (err && !this.ready) {
        this.ready = true
        this.readyErrorCbs.forEach(cb => { cb(err) })
      }
    })
  }

  // 确认过度
  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    const abort = err => {
      if (isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => { cb(err) })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    // 如果路由相同就直接返回
    if (
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      route.matched.length === current.matched.length
    ) {
      this.ensureURL()
      return abort()
    }

    // 交叉比对当前路由的路由记录和现在的这个路由的路由记录
    // 以便能准确得到父子路由更新的情况下可以确切的知道
    // 哪些组件需要更新 哪些不需要更新
    const {
      updated,
      deactivated,
      activated
    } = resolveQueue(this.current.matched, route.matched)

    // 整个路由切换生命周期队列
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards
      // leave 钩子
      extractLeaveGuards(deactivated),

      // global before hooks
      // 全局 router before hooks
      this.router.beforeHooks,

      // in-component update hooks
      // update 钩子
      extractUpdateHooks(updated),

      // in-config enter guards
      // 将要更新的路由的 beforeEnter 钩子
      activated.map(m => m.beforeEnter),

      // async components
      // 异步组件
      resolveAsyncComponents(activated)
    )

    this.pending = route

    // 每个队列执行的 iterator 函数
    const iterator = (hook: NavigationGuard, next) => {
      // 确保期间还是当前路由
      if (this.pending !== route) {
        return abort()
      }
      try {
        hook(route, current, (to: any) => {
          if (to === false || isError(to)) {
            // next(false) -> abort navigation, ensure current URL
            this.ensureURL(true)
            abort(to)
          } else if (
            typeof to === 'string' ||
            (typeof to === 'object' && (
              typeof to.path === 'string' ||
              typeof to.name === 'string'
            ))
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort()
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    // 执行队列
    runQueue(queue, iterator, () => {
      const postEnterCbs = []
      const isValid = () => this.current === route
      // wait until async components are resolved before
      // extracting in-component enter guards
      // 组件内的钩子
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
      const queue = enterGuards.concat(this.router.resolveHooks)

      // 在上次的队列执行完成后再执行组件内的钩子
      // 因为需要等异步组件以及是 OK 的情况下才能执行
      runQueue(queue, iterator, () => {
        // 确保期间还是当前路由
        if (this.pending !== route) {
          return abort()
        }
        this.pending = null
        onComplete(route)
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            postEnterCbs.forEach(cb => { cb() })
          })
        }
      })
    })
  }

  // 更新当前 route 对象
  updateRoute (route: Route) {
    const prev = this.current
    this.current = route

    // 注意 cb 的值，每次更新都会调用 下边需要用到！
    this.cb && this.cb(route)

    // 执行 after hooks 回调
    this.router.afterHooks.forEach(hook => {
      hook && hook(route, prev)
    })
  }
}

/**
 * 根据配置的 base 值获取绝对路径
 * @param {?string} base
 * @returns {string}
 */
function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      // 这里是获取 <base /> 标签的 href 属性值
      // 可能会有人没有在配置项配置 base 属性，但是在 html 配置了 <base /> 标签
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  // 确保 base 值以 / 开头
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  // 去除末尾的 /
  return base.replace(/\/$/, '')
}

function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}

function extractGuards (
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name)
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}

function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}

function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}

function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}

function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(activated, 'beforeRouteEnter', (guard, _, match, key) => {
    return bindEnterGuard(guard, match, key, cbs, isValid)
  })
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      next(cb)
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          poll(cb, match.instances, key, isValid)
        })
      }
    })
  }
}

function poll (
  cb: any, // somehow flow cannot infer this is a function
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance
  ) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
