import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { clearToken, loadToken, saveToken } from '../lib/token';

interface TokenCtx { token: string | null; setToken(t: string): void; clear(): void }
const Ctx = createContext<TokenCtx>(null!);

export function TokenProvider({ children }: { children: ReactNode }) {
  const [token, set] = useState<string | null>(() => loadToken());
  const setToken = useCallback((t: string) => { saveToken(t); set(t); }, []);
  const clear = useCallback(() => { clearToken(); set(null); }, []);
  return <Ctx.Provider value={{ token, setToken, clear }}>{children}</Ctx.Provider>;
}
export const useToken = () => useContext(Ctx);
