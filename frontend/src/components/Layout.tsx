import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import FamilySelector from './FamilySelector';

// 菜单项类型：叶子节点（path 必有）或分组节点（children 必有）
type MenuItem = {
  path?: string;
  label: string;
  icon: string;
  children?: MenuItem[];
  defaultOpen?: boolean;
};

const menuItems: MenuItem[] = [
  { path: '/', label: '仪表板', icon: '📊' },
  { path: '/alerts', label: '告警中心', icon: '🔔' },
  {
    label: '家庭与交易', icon: '🏠', defaultOpen: true,
    children: [
      { path: '/families', label: '家庭管理', icon: '👨‍👩‍👧‍👦' },
      { path: '/transactions', label: '交易记录', icon: '💰' },
      { path: '/budgets', label: '预算管理', icon: '🎯' },
      { path: '/recurring', label: '定期记账', icon: '🔁' },
      { path: '/goals', label: '财务目标', icon: '⭐' },
    ],
  },
  {
    label: '资产负债', icon: '💼',
    children: [
      { path: '/assets', label: '资产管理', icon: '🏠' },
      { path: '/liabilities', label: '负债管理', icon: '💳' },
      { path: '/net-worth', label: '净值趋势', icon: '📈' },
      { path: '/investment-income', label: '投资收益', icon: '💹' },
    ],
  },
  { path: '/reports', label: '财务报表', icon: '📈' },
  { path: '/ai', label: 'AI 助手', icon: '🤖' },
  {
    label: '工具', icon: '🧰',
    children: [
      { path: '/files', label: '文件管理', icon: '📁' },
      { path: '/compare', label: '家庭对比', icon: '⚖️' },
      { path: '/import', label: '数据导入', icon: '📥' },
      { path: '/import-sources', label: '同步配置', icon: '🔄' },
      { path: '/exchange-rates', label: '汇率管理', icon: '💱' },
    ],
  },
];

// 分组菜单项子组件：处理展开/折叠状态和子项渲染
function GroupedMenuItem({ item, currentPath, collapsed }: {
  item: MenuItem;
  currentPath: string;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(item.defaultOpen ?? false);

  // 当前路由命中任一子项时，父项高亮并自动展开
  const activeChild = item.children?.find(child => child.path === currentPath);
  useEffect(() => {
    if (activeChild) setOpen(true);
  }, [activeChild]);

  const isParentActive = !!activeChild;

  // 侧边栏折叠状态下：显示为单个图标按钮，hover 弹出浮层
  if (collapsed) {
    return (
      <div className="relative group">
        <button
          className={`flex items-center justify-center w-full px-4 py-3 rounded-lg transition-colors ${
            isParentActive ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'
          }`}
          aria-label={item.label}
        >
          <span className="text-xl">{item.icon}</span>
        </button>
        {/* hover 浮层 */}
        <div className="absolute left-full top-0 ml-2 hidden group-hover:block z-50 bg-white shadow-lg rounded-lg border border-gray-200 min-w-[160px]">
          <div className="px-4 py-2 text-xs font-medium text-gray-500 border-b border-gray-100">
            {item.label}
          </div>
          {item.children?.map(child => (
            <Link
              key={child.path}
              to={child.path!}
              className={`flex items-center px-4 py-2 text-sm transition-colors ${
                currentPath === child.path
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="mr-2">{child.icon}</span>
              {child.label}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  // 展开状态：父项按钮 + 可折叠子项列表
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-between w-full px-4 py-3 rounded-lg transition-colors ${
          isParentActive ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        <div className="flex items-center">
          <span className="text-xl">{item.icon}</span>
          <span className="ml-3">{item.label}</span>
        </div>
        <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <div className="mt-1 ml-4 space-y-1 border-l border-gray-200 pl-2">
          {item.children?.map(child => (
            <Link
              key={child.path}
              to={child.path!}
              className={`flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                currentPath === child.path
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="mr-2">{child.icon}</span>
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// 渲染单个菜单项（叶子 or 分组）
function renderMenuItem(item: MenuItem, currentPath: string, collapsed: boolean) {
  if (item.children && item.children.length > 0) {
    return (
      <GroupedMenuItem
        key={item.label}
        item={item}
        currentPath={currentPath}
        collapsed={collapsed}
      />
    );
  }
  // 叶子节点
  if (collapsed) {
    return (
      <Link
        key={item.path}
        to={item.path!}
        className={`flex items-center justify-center w-full px-4 py-3 rounded-lg transition-colors ${
          currentPath === item.path
            ? 'bg-indigo-50 text-indigo-600'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
        title={item.label}
      >
        <span className="text-xl">{item.icon}</span>
      </Link>
    );
  }
  return (
    <Link
      key={item.path}
      to={item.path!}
      className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
        currentPath === item.path
          ? 'bg-indigo-50 text-indigo-600'
          : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span className="text-xl">{item.icon}</span>
      <span className="ml-3">{item.label}</span>
    </Link>
  );
}

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop expand/collapse
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false); // mobile drawer
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex">
        {/* Sidebar - desktop */}
        <aside
          className={`${
            sidebarOpen ? 'w-64' : 'w-20'
          } bg-white shadow-lg transition-all duration-300 min-h-screen hidden md:block`}
        >
          <div className="p-4 border-b border-gray-200">
            <h1 className={`font-bold text-xl text-indigo-600 ${!sidebarOpen && 'hidden'}`}>
              Family Finance
            </h1>
            {!sidebarOpen && <h1 className="font-bold text-xl text-indigo-600 text-center">F</h1>}
          </div>
          <nav className="p-4 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
            {menuItems.map(item => renderMenuItem(item, location.pathname, !sidebarOpen))}
          </nav>
        </aside>

        {/* Sidebar - mobile drawer */}
        {mobileSidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black bg-opacity-50"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative w-64 bg-white shadow-xl min-h-screen overflow-y-auto">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h1 className="font-bold text-xl text-indigo-600">Family Finance</h1>
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="text-gray-500 hover:text-gray-900 text-2xl leading-none"
                  aria-label="关闭菜单"
                >
                  ×
                </button>
              </div>
              <nav className="p-4 space-y-2">
                {menuItems.map(item => renderMenuItem(item, location.pathname, false))}
              </nav>
            </aside>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <header className="bg-white shadow-sm px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-30">
            <div className="flex items-center space-x-2 md:space-x-4">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden text-gray-600 hover:text-gray-900 p-2 -ml-2"
                aria-label="打开菜单"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="hidden md:block text-gray-600 hover:text-gray-900"
                aria-label="切换侧边栏"
              >
                {sidebarOpen ? '◀' : '▶'}
              </button>
              <div className="w-36 md:w-48">
                <FamilySelector />
              </div>
            </div>
            <div className="flex items-center space-x-2 md:space-x-4">
              <span className="text-gray-700 text-sm md:text-base hidden sm:inline">欢迎，{user?.name}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-600 hover:text-red-600 px-3 py-2 border border-gray-300 rounded hover:border-red-300 transition-colors"
              >
                退出
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
};

export default Layout;
