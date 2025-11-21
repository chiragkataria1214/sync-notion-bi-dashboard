interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  variant?: 'spinner' | 'dots' | 'pulse';
  fullScreen?: boolean;
}

export default function LoadingSpinner({
  size = 'md',
  message = 'Loading...',
  variant = 'spinner',
  fullScreen = false,
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16',
  };

  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  const containerClasses = fullScreen
    ? 'flex items-center justify-center min-h-screen'
    : 'flex items-center justify-center min-h-[400px]';

  const renderSpinner = () => {
    switch (variant) {
      case 'dots':
        return (
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="h-3 w-3 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="h-3 w-3 bg-blue-500 rounded-full animate-bounce"></div>
          </div>
        );
      case 'pulse':
        return (
          <div className={`${sizeClasses[size]} relative`}>
            <div className={`absolute inset-0 rounded-full bg-blue-500 opacity-75 animate-ping`}></div>
            <div className={`absolute inset-0 rounded-full bg-blue-500`}></div>
            <div className={`absolute inset-2 rounded-full bg-white`}></div>
          </div>
        );
      default: // 'spinner'
        return (
          <div className="relative">
            <div
              className={`${sizeClasses[size]} border-4 border-gray-200 rounded-full`}
            ></div>
            <div
              className={`${sizeClasses[size]} border-4 border-blue-500 border-t-transparent rounded-full animate-spin absolute top-0 left-0`}
            ></div>
          </div>
        );
    }
  };

  return (
    <div className={containerClasses}>
      <div className="flex flex-col items-center gap-4">
        {renderSpinner()}
        {message && (
          <p className={`text-gray-600 ${textSizeClasses[size]} font-medium animate-pulse`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

