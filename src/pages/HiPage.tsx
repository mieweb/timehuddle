/**
 * HiPage — Simple smoke test page to verify frontend deployment
 */
import React from 'react';
import { Card, CardContent } from '@mieweb/ui';

export function HiPage() {
  const deployTime = new Date().toISOString();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="p-8 text-center">
          <h1 className="text-4xl font-bold mb-4">👋 Hi from Frontend!</h1>
          <p className="text-lg text-gray-600 mb-2">Frontend deployment verified</p>
          <p className="text-sm text-gray-400">Page loaded: {deployTime}</p>
          <p className="text-sm text-gray-400 mt-2">
            Version: {import.meta.env.VITE_APP_VERSION || '1.0.0'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
