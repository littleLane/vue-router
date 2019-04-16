import View from './components/view'
import Link from './components/link'

// 导出一个 Vue 引用
// 插件在打包的时候不希望把 vue 作为一个依赖包打进去，又希望使用 Vue 对象本身的一些方法，
// 此时就可以采用类似的做法，在 install 的时候把这个变量赋值 Vue ，
// 这样就可以在其他地方使用 Vue 的一些方法而不必引入 vue 依赖包
// ⚠️ 前提是保证 install 后才会使用，因为 _Vue 在 install 之后才被赋值
export let _Vue

// Vue 插件注册逻辑 install
// 通过 Vue.use(VueRouter) 就可以对 vue-router 进行注册
export function install (Vue) {
  // 防止插件重复安装
  if (install.installed && _Vue === Vue) return

  // 插件安装过的标识状态
  install.installed = true

  // 赋值私有的 Vue 引用
  _Vue = Vue

  const isDef = v => v !== undefined

  // 注册实例
  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  // 通过 Vue.mixin 方法全局注册一个混入，影响注册之后所有创建的每个 Vue 实例
  Vue.mixin({
    beforeCreate () {
      // 如果 Vue 实例里面的 $options 上已经有 router 属性，说明是带有路由配置的实例被创建了，
      // 继续初始化路由相关逻辑, 加上响应式的 _route 属性
      // new Vue({ router })
      if (isDef(this.$options.router)) {
        // 指向自身
        this._routerRoot = this

        // vue-router 实例，通过 new Vue() 传入
        this._router = this.$options.router

        // 初始化 router
        this._router.init(this)
        
        // 定义响应式的 _route 属性
        // 即当 _route 值改变时，会自动调用 Vue 实例的 render() 方法，更新视图
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        // 如果 Vue 实例里面的 $options 上没有 router 属性，就重置 _routerRoot
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      registerInstance(this, this)
    },
    destroyed () {
      registerInstance(this)
    }
  })

  // 做属性代理，我们可以直接通过 this.$router 和 this.$route 访问属性值
  // 这里主要将属性扩展到 Vue 实例，也就意味着所有的组件都可以访问到这个实例原型上定义的属性。
  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })

  Object.defineProperty(Vue.prototype, '$route', {
    get () { return this._routerRoot._route }
  })

  // 注册 router-view 和 router-link 两个组件
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)

  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
