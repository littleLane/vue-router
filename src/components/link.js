/* @flow */

import { createRoute, isSameRoute, isIncludedRoute } from '../util/route'
import { extend } from '../util/misc'

// work around weird flow bug
const toTypes: Array<Function> = [String, Object]
const eventTypes: Array<Function> = [String, Array]

export default {
  name: 'RouterLink',
  props: {
    // 传入组件的目标路由链接
    to: {
      type: toTypes,
      required: true
    },
    // 创建的 html 标签，默认是 a 标签
    tag: {
      type: String,
      default: 'a'
    },
    // 完整模式，如果为 true 那么也就意味着绝对相等的路由才会增加 activeClass，否则是包含关系
    exact: Boolean,
    // 在当前（相对）路劲上附加路径
    append: Boolean,
    // 如果为 true 则调用 router.replace() 做替换历史操作
    replace: Boolean,
    // 链接激活时使用的 CSS 类名
    activeClass: String,
    exactActiveClass: String,
    event: {
      type: eventTypes,
      default: 'click'
    }
  },
  render (h: Function) {
    // 获取 router 实例
    const router = this.$router
    // 获取当前激活的 route 对象
    const current = this.$route
    const { location, route, href } = router.resolve(this.to, current, this.append)

    const classes = {}
    const globalActiveClass = router.options.linkActiveClass
    const globalExactActiveClass = router.options.linkExactActiveClass
    // Support global empty active class
    const activeClassFallback = globalActiveClass == null
      ? 'router-link-active'
      : globalActiveClass
    const exactActiveClassFallback = globalExactActiveClass == null
      ? 'router-link-exact-active'
      : globalExactActiveClass
    
    // 获取激活 class
    const activeClass = this.activeClass == null
      ? activeClassFallback
      : this.activeClass

    // 获取激活 exactActiveClass
    const exactActiveClass = this.exactActiveClass == null
      ? exactActiveClassFallback
      : this.exactActiveClass
    
    // 相比较目标，因为有命名路由，所以不一定有 path
    const compareTarget = location.path
      ? createRoute(null, location, null, router)
      : route

    classes[exactActiveClass] = isSameRoute(current, compareTarget)

    // 如果严格模式的话 就判断是否是相同路由（path query params hash）
    // 否则就走包含逻辑（path包含，query包含 hash为空或者相同）
    classes[activeClass] = this.exact
      ? classes[exactActiveClass]
      : isIncludedRoute(current, compareTarget)

    // 处理跳转逻辑
    const handler = e => {
      if (guardEvent(e)) {
        if (this.replace) {
          // replace 逻辑
          router.replace(location)
        } else {
          // push 逻辑
          router.push(location)
        }
      }
    }

    const on = { click: guardEvent }
    if (Array.isArray(this.event)) {
      this.event.forEach(e => { on[e] = handler })
    } else {
      on[this.event] = handler
    }

    const data: any = {
      class: classes
    }

    // 如果当前标签为 a 则给予这个元素事件绑定和 href 属性
    if (this.tag === 'a') {
      data.on = on
      data.attrs = { href }
    } else {
      // find the first <a> child and apply listener and href
      // 找到第一个 <a> 给予这个元素事件绑定和 href 属性
      const a = findAnchor(this.$slots.default)
      if (a) {
        // in case the <a> is a static node
        a.isStatic = false
        const aData = a.data = extend({}, a.data)
        aData.on = on
        const aAttrs = a.data.attrs = extend({}, a.data.attrs)
        aAttrs.href = href
      } else {
        // doesn't have <a> child, apply listener to self
        // 没有 <a> 的话就给当前元素自身绑定时间
        data.on = on
      }
    }

    // 创建元素
    return h(this.tag, data, this.$slots.default)
  }
}

function guardEvent (e) {
  // don't redirect with control keys
  // 忽略带有功能键的点击
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
  // don't redirect when preventDefault called
  // 已阻止的返回
  if (e.defaultPrevented) return
  // don't redirect on right click
  // 右击
  if (e.button !== undefined && e.button !== 0) return
  // don't redirect if `target="_blank"`
  // 忽略 `target="_blank"`
  if (e.currentTarget && e.currentTarget.getAttribute) {
    const target = e.currentTarget.getAttribute('target')
    if (/\b_blank\b/i.test(target)) return
  }
  // this may be a Weex event which doesn't have this method
  // 阻止默认行为 防止跳转
  if (e.preventDefault) {
    e.preventDefault()
  }
  return true
}

function findAnchor (children) {
  if (children) {
    let child
    for (let i = 0; i < children.length; i++) {
      child = children[i]
      if (child.tag === 'a') {
        return child
      }
      if (child.children && (child = findAnchor(child.children))) {
        return child
      }
    }
  }
}
