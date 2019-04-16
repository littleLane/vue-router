/* @flow */

import { install } from './install'
import { START } from './util/route'
import { assert } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'

export default class VueRouter {
  static install: () => void;
  static version: string;

  app: any;
  apps: Array<any>;
  ready: boolean;
  readyCbs: Array<Function>;
  options: RouterOptions;
  // 接受字符串类型的数据，标识 history 类别
  // 有 history、hash、abstract 三种参数
  mode: string;
  // 实际的路由模式起作用的属性
  // 有 HashHistory、HTML5History、AbstractHistory 三种类型参数
  history: HashHistory | HTML5History | AbstractHistory;
  matcher: Matcher;
  // 一个 boolean 类型的值
  // 如果浏览器不支持 history 模式就回滚为 hash 模式
  fallback: boolean;
  beforeHooks: Array<?NavigationGuard>;
  resolveHooks: Array<?NavigationGuard>;
  afterHooks: Array<?AfterNavigationHook>;

  constructor (options: RouterOptions = {}) {
    this.app = null
    this.apps = []
    this.options = options
    this.beforeHooks = []
    this.resolveHooks = []
    this.afterHooks = []
    // 创建 match 匹配函数
    this.matcher = createMatcher(options.routes || [], this)

    // 如果用户没有配置 mode 值，就默认是 hash
    let mode = options.mode || 'hash'
    // mode === 'history' 配置的模式是 history 模式
    // !supportsPushState 不支持 pushState 方法，因为 pushState 是 h5 history 模式的方法，这里表示老旧的浏览器不支持 h5 history
    // options.fallback !== false 配置的 fallback 属性标识是否在浏览器不支持 h5 history 的情况下自动进行降级处理，这里显示的配置了 false 就不会做降级处理
    this.fallback = mode === 'history' && !supportsPushState && options.fallback !== false

    // 如果修正的 this.fallback 是 true 就将路由模式改成 hash 
    if (this.fallback) {
      mode = 'hash'
    }

    // 这里如果当前环境不是浏览器环境就将路由模式改成 abstract
    // 可能在 node 环境，就会支持 abstract 模式 
    if (!inBrowser) {
      mode = 'abstract'
    }
    this.mode = mode

    // 这里会根据最终的 mode 实例化不同的实例
    switch (mode) {
      case 'history':
        this.history = new HTML5History(this, options.base)
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  match (
    raw: RawLocation,
    current?: Route,
    redirectedFrom?: Location
  ): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }

  get currentRoute (): ?Route {
    return this.history && this.history.current
  }

  // Router 初始化逻辑
  // app 为 Vue 组件实例
  init (app: any /* Vue component instance */) {
    // 做 Vue.use(VueRouter) 插件安装检查
    process.env.NODE_ENV !== 'production' && assert(
      install.installed,
      `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
      `before creating root instance.`
    )

    this.apps.push(app)

    // main app already initialized.
    if (this.app) {
      return
    }

    this.app = app

    const history = this.history

    // 根据 history 的类别执行相应的初始化操作和监听
    if (history instanceof HTML5History) {
      history.transitionTo(history.getCurrentLocation())
    } else if (history instanceof HashHistory) {
      const setupHashListener = () => {
        history.setupListeners()
      }
      history.transitionTo(
        history.getCurrentLocation(),
        setupHashListener,
        setupHashListener
      )
    }

    // 设置当前历史对象的 cb 值, 在 transitionTo 的时候知道在 history 更新完毕的时候调用这个 cb
    // 然后看这里设置的这个函数的作用就是更新下当前应用实例的 _route 的值
    history.listen(route => {
      this.apps.forEach((app) => {
        app._route = route
      })
    })
  }

  // beforeEach 路由钩子
  beforeEach (fn: Function): Function {
    return registerHook(this.beforeHooks, fn)
  }

  // beforeResolve 路由钩子
  beforeResolve (fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }

  // afterEach 路由钩子
  afterEach (fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }

  // VueRouter 类暴露的以下方法实际是调用具体 history 对象的方法  === start ====
  onReady (cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }

  onError (errorCb: Function) {
    this.history.onError(errorCb)
  }

  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    this.history.push(location, onComplete, onAbort)
  }

  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    this.history.replace(location, onComplete, onAbort)
  }

  go (n: number) {
    this.history.go(n)
  }

  back () {
    this.go(-1)
  }

  forward () {
    this.go(1)
  }
  // VueRouter 类暴露的以下方法实际是调用具体 history 对象的方法  === end ====

  getMatchedComponents (to?: RawLocation | Route): Array<any> {
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    return [].concat.apply([], route.matched.map(m => {
      return Object.keys(m.components).map(key => {
        return m.components[key]
      })
    }))
  }

  resolve (
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    const location = normalizeLocation(
      to,
      current || this.history.current,
      append,
      this
    )
    const route = this.match(location, current)
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }

  addRoutes (routes: Array<RouteConfig>) {
    this.matcher.addRoutes(routes)
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}

function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

// 将 install 方法赋值给 VueRouter.install 用于 Vue.use()
VueRouter.install = install
VueRouter.version = '__VERSION__'

// 如果是在浏览器利用 script 标签引入，而且有全局的 Vue 实例就自动使用插件
if (inBrowser && window.Vue) {
  window.Vue.use(VueRouter)
}
