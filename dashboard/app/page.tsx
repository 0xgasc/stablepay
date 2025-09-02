import StatsCards from './components/StatsCards';
import OrdersList from './components/OrdersList';
import RefundsList from './components/RefundsList';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-b border-gray-200 pb-5">
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold leading-6 text-gray-900">
                StablePay Dashboard
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                🧪 Testnet
              </span>
            </div>
            <p className="mt-2 max-w-4xl text-sm text-gray-500">
              Manage testnet USDC payments on Base Sepolia and Ethereum Sepolia
            </p>
          </div>

          <div className="mt-8">
            <StatsCards />
          </div>

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="lg:col-span-2">
              <OrdersList />
            </div>
          </div>

          <div className="mt-8">
            <RefundsList />
          </div>
        </div>
      </div>
    </div>
  );
}