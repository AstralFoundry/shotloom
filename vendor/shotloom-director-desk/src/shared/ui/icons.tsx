import { ArrowUpRight, ArrowDownToLine, Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Clapperboard, Copy, Download, EllipsisVertical, Eye, EyeOff, Focus, GripVertical, House, Image, Import, Layers, LayoutGrid, Lightbulb, Maximize, MessageCircle, Moon, Move, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Rotate3D, Search, Settings2, Spline, Square, Sun, Tag, Trash2, Undo2, UserRound, X, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

// One stroke and optical size for the director's primary controls.
function directorIcon(Glyph: LucideIcon) {
    return function DirectorIcon({ className = '', ...props }: ComponentProps<'span'>) {
        return <span {...props} className={`anticon ${className}`}><Glyph size="1em" strokeWidth={1.65} aria-hidden="true" /></span>;
    };
}

export const ArrowDownToLineIcon = directorIcon(ArrowDownToLine);
export const CameraIcon = directorIcon(Camera);
export const ChevronDownIcon = directorIcon(ChevronDown);
export const ChevronLeftIcon = directorIcon(ChevronLeft);
export const ChevronRightIcon = directorIcon(ChevronRight);
export const ChevronUpIcon = directorIcon(ChevronUp);
export const CircleHelpIcon = directorIcon(CircleHelp);
export const ClapperboardIcon = directorIcon(Clapperboard);
export const CopyIcon = directorIcon(Copy);
export const DownloadIcon = directorIcon(Download);
export const EllipsisVerticalIcon = directorIcon(EllipsisVertical);
export const EyeIcon = directorIcon(Eye);
export const EyeOffIcon = directorIcon(EyeOff);
export const FocusIcon = directorIcon(Focus);
export const GripVerticalIcon = directorIcon(GripVertical);
export const HouseIcon = directorIcon(House);
export const ImageIcon = directorIcon(Image);
export const ImportIcon = directorIcon(Import);
export const LayersIcon = directorIcon(Layers);
export const LayoutGridIcon = directorIcon(LayoutGrid);
export const LightbulbIcon = directorIcon(Lightbulb);
export const MaximizeIcon = directorIcon(Maximize);
export const MessageCircleIcon = directorIcon(MessageCircle);
export const MoonIcon = directorIcon(Moon);
export const MoveIcon = directorIcon(Move);
export const PanelLeftCloseIcon = directorIcon(PanelLeftClose);
export const PanelLeftOpenIcon = directorIcon(PanelLeftOpen);
export const PlusIcon = directorIcon(Plus);
export const Redo2Icon = directorIcon(Redo2);
export const Rotate3DIcon = directorIcon(Rotate3D);
export const SearchIcon = directorIcon(Search);
export const Settings2Icon = directorIcon(Settings2);
export const SplineIcon = directorIcon(Spline);
export const SquareIcon = directorIcon(Square);
export const SunIcon = directorIcon(Sun);
export const TagIcon = directorIcon(Tag);
export const Trash2Icon = directorIcon(Trash2);
export const Undo2Icon = directorIcon(Undo2);
export const UserRoundIcon = directorIcon(UserRound);
export const XIcon = directorIcon(X);

export const ArrowUpRightIcon = directorIcon(ArrowUpRight);
