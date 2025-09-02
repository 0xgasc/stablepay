'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Check, X, RefreshCw } from 'lucide-react';

interface Refund {
  id: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: string;
  approvedBy?: string;
  order: {
    id: string;
    chain: string;
    customerEmail?: string;
  };
}

export default function RefundsList() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRefunds = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/refunds/pending');
      const data = await response.json();
      setRefunds(data);
    } catch (error) {
      console.error('Failed to fetch refunds:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRefunds();
  }, []);

  const handleApprove = async (refundId: string) => {
    try {
      const response = await fetch(`/api/refunds/${refundId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'Admin' }),
      });
      
      if (response.ok) {
        fetchRefunds();
      }
    } catch (error) {
      console.error('Failed to approve refund:', error);
    }
  };

  const handleReject = async (refundId: string) => {
    try {
      const response = await fetch(`/api/refunds/${refundId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'Admin' }),
      });
      
      if (response.ok) {
        fetchRefunds();
      }
    } catch (error) {
      console.error('Failed to reject refund:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          Pending Refunds ({refunds.length})
        </h2>
        <button
          onClick={fetchRefunds}
          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>

      {refunds.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500">No pending refunds</p>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul role="list" className="divide-y divide-gray-200">
            {refunds.map((refund) => (
              <li key={refund.id}>
                <div className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          ${refund.amount.toFixed(2)} USDC
                        </p>
                        <p className="text-sm text-gray-500">
                          Order: {refund.order.id.substring(0, 8)}...
                        </p>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        {refund.order.chain}
                      </span>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleApprove(refund.id)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(refund.id)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Reject
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">Reason:</span> {refund.reason}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Customer: {refund.order.customerEmail || 'Anonymous'} • 
                      Requested {format(new Date(refund.createdAt), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}