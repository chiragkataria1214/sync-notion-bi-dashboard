import { Page } from '@shopify/polaris';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {children}
    </div>
  );
}

