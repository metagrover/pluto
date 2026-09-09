import { AlertCircle, Folder, Lock, RefreshCw, XCircle } from 'lucide-react';
import { type FC, useState } from 'react';

export interface DatabaseRecoveryOverlayProps {
  visible: boolean;
  errorCode?: string;
  errorMessage?: string;
  onRetry: () => void;
  onOpenDataFolder: () => void;
  onQuit: () => void;
  onResetData?: () => void;
}

export const DatabaseRecoveryOverlay: FC<DatabaseRecoveryOverlayProps> = ({
  visible,
  errorCode = 'database_key_unavailable',
  errorMessage = 'Pluto could not access the encryption key in macOS Keychain.',
  onRetry,
  onOpenDataFolder,
  onQuit,
  onResetData,
}) => {
  const [showDestructiveConfirm, setShowDestructiveConfirm] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  if (!visible) return null;

  const isKeyIssue =
    errorCode === 'database_key_unavailable' ||
    errorCode === 'database_key_rejected';

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in">
      <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-zinc-900 dark:text-zinc-100">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-rose-100 dark:bg-rose-950/50 rounded-xl text-rose-600 dark:text-rose-400">
            {isKeyIssue ? (
              <Lock className="w-6 h-6" />
            ) : (
              <AlertCircle className="w-6 h-6" />
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {isKeyIssue
                ? 'Database Encryption Locked'
                : 'Database Recovery Required'}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
              Code: {errorCode}
            </p>
          </div>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed mb-6">
          {errorMessage}
        </p>

        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-xs leading-relaxed mb-6">
          <strong>Your data is preserved safely.</strong> Pluto will never
          replace or overwrite your encrypted database without your explicit
          action.
        </div>

        {!showDestructiveConfirm ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={onRetry}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium text-sm hover:opacity-90 transition-opacity shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Retry Keychain Access</span>
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onOpenDataFolder}
                className="flex items-center justify-center space-x-2 py-2.5 px-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl font-medium text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                <Folder className="w-4 h-4" />
                <span>Open Data Folder</span>
              </button>
              <button
                type="button"
                onClick={onQuit}
                className="flex items-center justify-center space-x-2 py-2.5 px-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl font-medium text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                <span>Quit Pluto</span>
              </button>
            </div>

            {onResetData && (
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 text-center">
                <button
                  type="button"
                  onClick={() => setShowDestructiveConfirm(true)}
                  className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                >
                  Troubleshoot: Reset database (permanently deletes local
                  data)...
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50">
            <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-300">
              Confirm Permanent Database Reset
            </h3>
            <p className="text-xs text-rose-700 dark:text-rose-400 leading-relaxed">
              This action cannot be undone. All local transcripts, notes,
              recordings, and voice profiles will be permanently erased. Type{' '}
              <strong>RESET</strong> below to confirm.
            </p>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="RESET"
              className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-900 border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex space-x-3">
              <button
                type="button"
                disabled={confirmInput !== 'RESET'}
                onClick={onResetData}
                className="flex-1 py-2 px-3 bg-rose-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition-colors"
              >
                Permanently Erase & Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDestructiveConfirm(false);
                  setConfirmInput('');
                }}
                className="py-2 px-4 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
