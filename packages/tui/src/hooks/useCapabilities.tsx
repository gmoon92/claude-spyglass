/**
 * useCapabilities — Provider + hook around terminal Capabilities.
 */

import React, { createContext, useContext, type ReactNode } from 'react';
import { detect, type Capabilities } from '../lib/capabilities';

const CapabilitiesContext = createContext<Capabilities | null>(null);

export function CapabilitiesProvider({ children, value }: { children: ReactNode; value?: Capabilities }): JSX.Element {
  const caps = value ?? detect();
  return <CapabilitiesContext.Provider value={caps}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): Capabilities {
  const ctx = useContext(CapabilitiesContext);
  if (ctx) return ctx;
  return detect();
}
