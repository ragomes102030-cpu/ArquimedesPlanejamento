import classNames from 'classnames';
import React, { ErrorInfo, ReactNode } from 'react';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import {
  SettingsTabNavigateProvider,
  SettingsViewModeProvider,
} from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';
import { useExtensionSettingsTabs } from '@/renderer/hooks/system/useExtensionSettingsTabs';
import {
  BookOpen,
  Cat,
  Communication,
  Computer,
  Earth,
  Inbox,
  Info,
  Lightning,
  LinkCloud,
  Puzzle,
  Robot,
  System,
  Toolkit,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useExtI18n } from '@/renderer/hooks/system/useExtI18n';
import { BUILTIN_TAB_IDS, LEGACY_ANCHOR_REMAP } from './SettingsSider';
import './settings.css';

interface SettingsPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

type NavItem = { label: string; icon: React.ReactElement; path: string; id: string };

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

export function getBuiltinSettingsNavItems(isDesktop: boolean, t: TranslateFn): NavItem[] {
  const builtinMap: Record<string, NavItem> = {
    model: { id: 'model', label: t('settings.model'), icon: <LinkCloud theme='outline' size='16' />, path: 'model' },
    assistants: {
      id: 'assistants',
      label: t('settings.assistants', { defaultValue: 'Assistants' }),
      icon: <Robot theme='outline' size='16' />,
      path: 'assistants',
    },
    agent: {
      id: 'agent',
      label: t('settings.agents', { defaultValue: 'Agents' }),
      icon: <Robot theme='outline' size='16' />,
      path: 'agent',
    },
    memory: {
      id: 'memory',
      label: t('settings.memory', { defaultValue: 'Memories' }),
      icon: <BookOpen theme='outline' size='16' fill='currentColor' />,
      path: 'memory',
    },
    skills: {
      id: 'skills',
      label: t('settings.skills', { defaultValue: 'Skills' }),
      icon: <Lightning theme='outline' size='16' />,
      path: 'skills',
    },
    tools: {
      id: 'tools',
      label: t('settings.tools', { defaultValue: 'Tools' }),
      icon: <Toolkit theme='outline' size='16' />,
      path: 'tools',
    },
    appearance: {
      id: 'appearance',
      label: t('settings.appearancePanel'),
      icon: <Computer theme='outline' size='16' />,
      path: 'appearance',
    },
    webui: {
      id: 'webui',
      label: t('settings.webui'),
      icon: isDesktop ? <Earth theme='outline' size='16' /> : <Communication theme='outline' size='16' />,
      path: 'webui',
    },
    whatsapp: {
      id: 'whatsapp',
      label: t('settings.whatsapp', { defaultValue: 'WhatsApp' }),
      icon: <Communication theme='outline' size='16' />,
      path: 'whatsapp',
    },
    pet: { id: 'pet', label: t('pet.desktopPet'), icon: <Cat theme='outline' size='16' />, path: 'pet' },
    system: { id: 'system', label: t('settings.system'), icon: <System theme='outline' size='16' />, path: 'system' },
    archived: {
      id: 'archived',
      label: t('settings.archived.navLabel'),
      icon: <Inbox theme='outline' size='16' />,
      path: 'archived',
    },
    about: { id: 'about', label: t('settings.about'), icon: <Info theme='outline' size='16' />, path: 'about' },
  };

  return BUILTIN_TAB_IDS.map((id) => builtinMap[id]);
}

/**
 * Error Boundary que isola falhas de renderização de qualquer aba de Configurações
 * para que elas não deixem a página inteira escura/branca.
 */
class SettingsErrorBoundary extends React.Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[SettingsPageWrapper] render error caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='flex flex-col h-full overflow-hidden p-24px text-center'>
          <div className='text-t-danger text-14px font-medium'>Não foi possível carregar esta página de Configurações.</div>
          <div className='text-t-secondary text-12px mt-4px'>
            Tente recarregar o app. Se o problema persistir, reporte o erro.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = ({ children, className, contentClassName }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();

  const extensionTabs = useExtensionSettingsTabs();

  const { resolveExtTabName } = useExtI18n();

  const menuItems = React.useMemo(() => {
    const builtins = getBuiltinSettingsNavItems(isDesktop, t);

    // Insert extension tabs before system (unanchored default) or at anchor position
    const result = [...builtins];
    const unanchored: IExtensionSettingsTab[] = [];
    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();

    for (const tab of extensionTabs) {
      if (!tab.position) {
        unanchored.push(tab);
        continue;
      }
      const { relativeTo: rawAnchor, placement } = tab.position;
      const anchor = LEGACY_ANCHOR_REMAP[rawAnchor] ?? rawAnchor;
      if (!result.some((item) => item.id === anchor)) {
        unanchored.push(tab);
        continue;
      }
      const map = placement === 'before' ? beforeMap : afterMap;
      let list = map.get(anchor);
      if (!list) {
        list = [];
        map.set(anchor, list);
      }
      list.push(tab);
    }

    const toNavItem = (tab: IExtensionSettingsTab): NavItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? (
          <img src={resolvedIcon} alt='' className='w-16px h-16px object-contain' />
        ) : (
          <Puzzle theme='outline' size='16' />
        ),
        path: `ext/${tab.id}`,
      };
    };

    for (let i = result.length - 1; i >= 0; i--) {
      const id = result[i].id;
      const afters = afterMap.get(id);
      if (afters) result.splice(i + 1, 0, ...afters.map(toNavItem));
      const befores = beforeMap.get(id);
      if (befores) result.splice(i, 0, ...befores.map(toNavItem));
    }

    if (unanchored.length > 0) {
      const sysIdx = result.findIndex((item) => item.id === 'system');
      const idx = sysIdx >= 0 ? sysIdx : result.length;
      result.splice(idx, 0, ...unanchored.map(toNavItem));
    }

    return result;
  }, [isDesktop, t, extensionTabs, resolveExtTabName]);

  // Keep only horizontal padding on the scroll container — vertical padding is
  // moved to the content layer below. A sticky header inside a scroll container
  // with top padding would otherwise stick 32px down, letting content peek
  // through the gap above it.
  const containerClass = classNames(
    'settings-page-wrapper w-full min-h-full box-border overflow-y-auto',
    isMobile ? 'px-16px' : 'px-12px md:px-40px',
    className
  );

  const contentClass = classNames(
    'settings-page-content mx-auto w-full md:max-w-1024px py-14px md:py-32px',
    contentClassName
  );

  const navigateToTab = React.useCallback(
    (tabId: string) => {
      void navigate(`/settings/${tabId}`, { replace: true });
    },
    [navigate]
  );

  return (
    <SettingsErrorBoundary>
      <SettingsViewModeProvider value='page'>
        <SettingsTabNavigateProvider value={navigateToTab}>
          <div className={containerClass}>
            {isMobile && (
              <div className='settings-mobile-top-nav'>
                {menuItems.map((item) => {
                  const active = pathname.includes(`/settings/${item.path}`);
                  return (
                    <button
                      key={item.path}
                      type='button'
                      className={classNames('settings-mobile-top-nav__item', {
                        'settings-mobile-top-nav__item--active': active,
                      })}
                      onClick={() => {
                        void navigate(`/settings/${item.path}`, { replace: true });
                      }}
                    >
                      <span className='settings-mobile-top-nav__icon'>{item.icon}</span>
                      <span className='settings-mobile-top-nav__label'>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className={contentClass}>{children}</div>
          </div>
        </SettingsTabNavigateProvider>
      </SettingsViewModeProvider>
    </SettingsErrorBoundary>
  );
};

export default SettingsPageWrapper;
