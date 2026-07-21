import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import FamiliesPage from './pages/FamiliesPage';
import TransactionsPage from './pages/TransactionsPage';
import AssetsPage from './pages/AssetsPage';
import LiabilitiesPage from './pages/LiabilitiesPage';
import BalanceSheetPage from './pages/BalanceSheetPage';
import IncomeStatementPage from './pages/IncomeStatementPage';
import CashFlowPage from './pages/CashFlowPage';
import InvestmentPage from './pages/InvestmentPage';
import AIPage from './pages/AIPage';
import AIAnalysisPage from './pages/AIAnalysisPage';
import FilesPage from './pages/FilesPage';
import BudgetPage from './pages/BudgetPage';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout>
                <DashboardPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/families"
          element={
            <ProtectedRoute>
              <Layout>
                <FamiliesPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/transactions"
          element={
            <ProtectedRoute>
              <Layout>
                <TransactionsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/assets"
          element={
            <ProtectedRoute>
              <Layout>
                <AssetsPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/liabilities"
          element={
            <ProtectedRoute>
              <Layout>
                <LiabilitiesPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/balance-sheet"
          element={
            <ProtectedRoute>
              <Layout>
                <BalanceSheetPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/income-statement"
          element={
            <ProtectedRoute>
              <Layout>
                <IncomeStatementPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/cash-flow"
          element={
            <ProtectedRoute>
              <Layout>
                <CashFlowPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/investment"
          element={
            <ProtectedRoute>
              <Layout>
                <InvestmentPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai"
          element={
            <ProtectedRoute>
              <Layout>
                <AIPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/ai-analysis"
          element={
            <ProtectedRoute>
              <Layout>
                <AIAnalysisPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/files"
          element={
            <ProtectedRoute>
              <Layout>
                <FilesPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/budgets"
          element={
            <ProtectedRoute>
              <Layout>
                <BudgetPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <Layout>
                <div className="text-center py-12">
                  <h2 className="text-2xl font-bold text-gray-900">页面开发中</h2>
                  <p className="text-gray-500 mt-2">该功能正在建设中，敬请期待</p>
                </div>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
