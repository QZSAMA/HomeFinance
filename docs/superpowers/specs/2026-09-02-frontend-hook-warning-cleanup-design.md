# 前端 Hook 依赖与 warning 清理设计

- 日期：2026-09-02
- 范围：P1-G-06 的前端质量子切片
- 状态：已获用户批准，待实施

## 目标

清理当前前端 lint 报告的 16 条 warning，修复数据加载函数在 `useEffect` 中的依赖声明，避免家庭切换或组件重渲染时出现陈旧闭包、漏刷新或重复请求风险；同时移除一个未使用的 catch 参数。

本切片不改变 API、路由、财务计算、权限策略或缓存协议。

## 方案

对被 `useEffect` 调用、且也被按钮/提交处理器复用的数据加载函数使用 `useCallback` 稳定引用；回调依赖只包含其实际读取的家庭 ID、筛选条件和稳定的 store/service 引用。`useEffect` 显式依赖该回调及触发条件，家庭切换和筛选变化仍会触发一次加载。对于只在一个 effect 内使用的局部加载函数，保留 effect 内联形式并完整声明依赖，避免无意义的组件级回调。

错误处理保持现有用户可见文案和日志行为。静默失败场景删除未使用的 `err` 绑定，不关闭 lint 规则，不引入全局 hook 抽象。

## 受影响组件

- `FamilySelector`、`FamiliesPage`
- `TransactionsPage`
- `AIPage`
- `DashboardPage`、`InvestmentPage`
- `AssetsPage`、`LiabilitiesPage`
- `BalanceSheetPage`、`CashFlowPage`、`IncomeStatementPage`
- `RecurringPage`、`BudgetPage`、`GoalsPage`、`FilesPage`

## 测试与验收

先增加一个聚焦的失败测试，证明代表性页面在稳定 props/store 状态下不会因为父组件重渲染而重复请求，并在家庭切换时重新请求。最小实现后运行该测试，再扩展到受影响页面的现有组件测试或服务 mock。

验收条件：

1. 前端测试全部通过；
2. `npm run lint` 无新增 warning，目标 16 条 warning 清零；
3. `npm run build` 通过，bundle 体积警告作为独立 P1-G-06 工作保留；
4. 页面初次加载、家庭切换、筛选/重试、提交后刷新行为与改动前一致；
5. 不修改后端或财务语义；Graphify semantic refresh 仍按全局 tracker 处理。

## 回滚

按单一提交回滚本切片即可恢复原有函数结构；不需要数据库迁移或数据回滚。
