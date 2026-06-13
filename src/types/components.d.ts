import type { Dispatch, ReactNode, RefObject } from 'react';

interface WidgetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  id?: string;
  children?: ReactNode;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  [key: string]: any;
}

interface PromptContainerProps {
  sidebarHeight: number;
}

interface MarkdownPreviewProps {
  sidebarHeight: number;
}

interface ProbsDisplayProps {}

interface SidebarProps {
  sidebarRef: RefObject<HTMLDivElement | null>;
  toggleModal: (key: string) => void;
  currentThemeName: string;
  setCurrentThemeName: Dispatch<string>;
  allThemes: Record<string, ThemeData>;
  showAPIKey: boolean;
  setShowAPIKey: Dispatch<boolean>;
}

interface CrashScreenFallbackProps {
  error: Error;
}

interface SearchAndReplaceWidgetProps {
  isOpen: boolean;
  closeWidget: () => void;
  id: string;
  children?: ReactNode;
  promptArea: RefObject<HTMLTextAreaElement | null>;
  promptText: string;
  cancel: (() => void) | null;
}

interface EditorContextMenuProps {
  isOpen: boolean;
  closeMenu: () => void;
  menuItems: ContextMenuItem[];
  className?: string;
  x?: number;
  y?: number;
}

interface ContextMenuItem {
  label: string;
  action?: () => void;
  disabled: boolean;
  subItems?: Array<{ label: string; action: () => void; disabled: boolean }>;
}

interface QuickSwitcherProps {
  isOpen: boolean;
  closeModal: () => void;
  sessionStorage: SessionStorage;
  cancel: (() => void) | null;
}

interface ModalsProps {
  toggleModal: (key: string) => void;
  currentThemeName: string;
  setCurrentThemeName: Dispatch<string>;
  allThemes: Record<string, ThemeData>;
  setAllThemes: Dispatch<Record<string, ThemeData>>;
  applyChatTemplate: () => void;
}

interface AppProps {
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

interface ModalsProps {
  toggleModal: (key: string) => void;
  currentThemeName: string;
  setCurrentThemeName: Dispatch<string>;
  allThemes: Record<string, ThemeData>;
  setAllThemes: Dispatch<Record<string, ThemeData>>;
  applyChatTemplate: () => void;
}

interface CheckboxProps {
  label: string;
  value: boolean;
  hidden?: boolean;
  onValueChange: (value: boolean) => void;
  title?: string;
  disabled?: boolean;
}

interface InputBoxProps {
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
  [key: string]: any;
}

interface InputSliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
  hidden?: boolean;
  strict?: boolean;
  onValueChange: (value: number) => void;
  [key: string]: any;
}

interface SelectBoxProps {
  label: string;
  value: any;
  hidden?: boolean;
  onValueChange: (value: any) => void;
  options: Array<{ name: string; value: any }> | (() => Array<{ name: string; value: any }>);
  disabled?: boolean;
  [key: string]: any;
}

interface CollapsibleGroupProps {
  label: string;
  stateLabel?: string;
  menu?: ReactNode;
  expanded?: boolean;
  children?: ReactNode;
}
