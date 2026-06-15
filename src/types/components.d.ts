import type { Dispatch, ReactNode, RefObject } from 'react';

export interface WidgetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  id?: string;
  children?: ReactNode;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
}

export interface PromptContainerProps {
  sidebarHeight: number;
}

export interface MarkdownPreviewProps {
  sidebarHeight: number;
}

export interface ProbsDisplayProps {}

export interface SidebarProps {
  sidebarRef: RefObject<HTMLDivElement | null>;
  toggleModal: (key: string) => void;
  currentThemeName: string;
  setCurrentThemeName: Dispatch<string>;
  allThemes: Record<string, ThemeData>;
  showAPIKey: boolean;
  setShowAPIKey: Dispatch<boolean>;
}

export interface CrashScreenFallbackProps {
  error: Error;
}

export interface SearchAndReplaceWidgetProps {
  isOpen: boolean;
  closeWidget: () => void;
  id: string;
  children?: ReactNode;
  promptArea: RefObject<HTMLTextAreaElement | null>;
  promptText: string;
  cancel: (() => void) | null;
}

export interface EditorContextMenuProps {
  isOpen: boolean;
  closeMenu: () => void;
  menuItems: ContextMenuItem[];
  className?: string;
  x?: number;
  y?: number;
}

export interface ContextMenuItem {
  label: string;
  action?: () => void;
  disabled: boolean;
  subItems?: Array<{ label: string; action: () => void; disabled: boolean }>;
}

export interface QuickSwitcherProps {
  isOpen: boolean;
  closeModal: () => void;
  sessionStorage: SessionStorage;
  cancel: (() => void) | null;
}

export interface ModalsProps {
  toggleModal: (key: string) => void;
  currentThemeName: string;
  setCurrentThemeName: Dispatch<string>;
  allThemes: Record<string, ThemeData>;
  setAllThemes: Dispatch<Record<string, ThemeData>>;
  applyChatTemplate: () => void;
}

export interface AppProps {
  sessionStorage: SessionStorage;
  templateStorage: TemplateStorage;
  themeStorage: ThemeStorage;
  connectionStorage: ConnectionStorage;
  useSessionState: <T>(name: string, initialState: T) => [T, Dispatch<T>];
  useDBTemplates: <T>(initialState: T) => [Record<string, InstructTemplate>, Dispatch<Record<string, InstructTemplate>>];
  useDBThemes: <T>(initialState: T) => [Record<string, ThemeData>, Dispatch<Record<string, ThemeData>>];
  useDBConnections: <T>(initialState: T) => [Record<string, ConnectionData>, Dispatch<Record<string, ConnectionData>>];
  isMiyapadEndpoint: boolean;
}

export interface CheckboxProps {
  label: string;
  value: boolean;
  hidden?: boolean;
  onValueChange: (value: boolean) => void;
  title?: string;
  disabled?: boolean;
}

export interface InputBoxProps {
  label: string;
  className?: string;
  tooltip?: string;
  tooltipSize?: string;
  value: string | number;
  type?: string;
  datalist?: string[];
  onValueChange: (value: string | number) => void;
  children?: ReactNode;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  inputmode?: string;
  pattern?: string;
}

export interface InputSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
  hidden?: boolean;
  strict?: boolean;
  onValueChange: (value: number) => void;
}

export interface SelectBoxProps<T = string> {
  label: string;
  value: T;
  hidden?: boolean;
  onValueChange: (value: T) => void;
  options: Array<{ name: string; value: T }> | (() => Array<{ name: string; value: T }>);
  disabled?: boolean;
}

export interface CollapsibleGroupProps {
  label: string;
  stateLabel?: string;
  menu?: ReactNode;
  expanded?: boolean;
  children?: ReactNode;
}
