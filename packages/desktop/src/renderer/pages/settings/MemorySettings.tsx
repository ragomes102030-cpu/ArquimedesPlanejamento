/**
 * @license
 * Copyright 2025 Arquimedes
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { ErrorInfo, ReactNode, useState } from 'react';
import { getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import SiderMemoryEntry from '@/renderer/components/layout/Sider/SiderMemoryEntry';

/**
 * Error Boundary que isola falhas de renderização do SiderMemoryEntry para que
 * elas não derrubem toda a página de Configurações (tela escura/branca).
 */
class MemoryErrorBoundary extends React.Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[MemorySettings] render error caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='flex flex-col h-full overflow-hidden p-24px text-center'>
          <div className='text-t-danger text-14px font-medium'>Não foi possível carregar as Memórias.</div>
          <div className='text-t-secondary text-12px mt-4px'>
            O restante das Configurações continua disponível.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MemorySettings() {
  return (
    <MemoryErrorBoundary>
      <div className='flex flex-col h-full overflow-hidden'>
        <SiderMemoryEntry
          isMobile={false}
          collapsed={false}
          siderTooltipProps={getSiderTooltipProps(false)}
          onSessionClick={undefined}
        />
      </div>
    </MemoryErrorBoundary>
  );
}
