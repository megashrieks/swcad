/**
 * The slice of `@pomavo/ui` swcad uses, vendored.
 *
 * The published package peers on Tailwind v4 + React 19 (which we now match) but also
 * pulls in tiptap, recharts, react-router and Pomavo's own API/domain types, none of
 * which belong in a local CAD tool. These files are copied verbatim except for the
 * `@pomavo/ui/lib/utils` import, which is rewritten to the local `cn` helper.
 */
export { cn } from './lib/utils';

export { Button, buttonVariants } from './components/button';
export { Input } from './components/input';
export { Textarea } from './components/textarea';
export { Label } from './components/label';
export { Checkbox } from './components/checkbox';
export { Switch } from './components/switch';
export { Separator } from './components/separator';
export { Badge } from './components/badge';
export { Spinner } from './components/spinner';
export { Skeleton } from './components/skeleton';
export { Progress } from './components/progress';
export { Callout } from './components/callout';
export { ScrollArea, ScrollBar } from './components/scroll-area';
export { ToolbarIconButton } from './components/toolbar-icon-button';
export { DialogActions } from './components/dialog-actions';

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select';

export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card';

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/dialog';

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './components/alert-dialog';

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/dropdown-menu';

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './components/popover';
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/tooltip';
export { ToastProvider, useToast } from './components/toast';

export * from './theme/theme-registry';
export * from './theme/theme-core';
