import { createContext, useContext, useMemo } from "react";

const demoUser = {
  id: "anonymous",
  uid: "anonymous",
  email: "demo@utilityhub.com",
  displayName: "Demo user",
  emailConfirmed: true,
  dev: true,
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const value = useMemo(() => ({
    mode: "demo",
    configured: true,
    status: "ready",
    user: demoUser,
    isAuthenticated: true,
  }), []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
