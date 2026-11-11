import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { KeyRoundIcon, LogOutIcon, Menu, Monitor, MoonIcon, PersonStanding, RotateCwIcon, SunIcon } from "lucide-react";
import { PiMagnifyingGlass } from "react-icons/pi";
import DesktopNavbar from "./DesktopNavbar";
import Avatar from "@/components/Avatar";
import { useAuth } from "@/hooks/auth";
import { useGlobalMenuSheet, usePlayerlistSheet, useServerSheet } from "@/hooks/sheets";
import { useTheme } from "@/hooks/theme";
import { useAtomValue, useSetAtom } from "jotai";
import { serverNameAtom } from "@/hooks/status";
import { playerCountAtom } from "@/hooks/playerlist";
import { quickSearchOpenAtom, useAccountModal } from "@/hooks/dialogs";
import { LogoSquareGreen, LogoFullSquareGreen } from "@/components/Logos";
import { NavLink } from "@/components/MainPageLink";
import { panelOutdatedAtom } from "@/hooks/connection";


function ServerTitle() {
    const playerCount = useAtomValue(playerCountAtom);
    const serverName = useAtomValue(serverNameAtom);

    return (
        <div className="flex justify-start">
            <h1 className="line-clamp-1 text-base break-all">
                {serverName}
            </h1>
            <span>
                :&nbsp;
                <span className="font-mono" title="players connected">{playerCount}</span>
            </span>
        </div>
    );
}


type NavButtonProps = {
    className?: string;
};
const navButtonClasses = `h-11 w-11 sm:h-10 sm:min-w-max sm:px-2 lg:px-3
    flex justify-center items-center gap-2
    rounded-md border text-sm text-muted-foreground transition-colors
    hover:bg-muted hover:text-foreground hover:border-input
    ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
`;

const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
const quickSearchKeys = isApple ? ['⌘', 'K'] : ['Ctrl', 'K'];

/** Opens the Ctrl+K search window; drawn as a recessed search field so it reads as one. */
function ButtonQuickSearch({ className }: NavButtonProps) {
    const setQuickSearchOpen = useSetAtom(quickSearchOpenAtom);
    return (
        <button
            className={cn(
                'flex h-11 w-11 items-center justify-center gap-2.5 rounded-lg border text-sm text-muted-foreground transition-colors',
                // the desktop nav fills the header between lg and 2xl, so the field folds to its icon there
                'sm:h-10 sm:w-48 sm:justify-start sm:pl-3 sm:pr-2 lg:w-10 lg:justify-center lg:px-0 2xl:w-52 2xl:justify-start 2xl:pl-3 2xl:pr-2 3xl:w-96',
                'bg-background shadow-[inset_0_1px_2px_rgb(0_0_0/0.45)] hover:border-foreground/25 hover:text-foreground',
                'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                className,
            )}
            title={`Search (${quickSearchKeys.join(' ')})`}
            onClick={() => setQuickSearchOpen(true)}
        >
            <PiMagnifyingGlass className="h-6 w-6 shrink-0 sm:h-4 sm:w-4" />
            <span className="hidden truncate sm:inline lg:hidden 2xl:inline 3xl:hidden">Search</span>
            <span className="hidden truncate 3xl:inline">Search players, actions and pages</span>
            <span className="ml-auto hidden shrink-0 gap-1 sm:flex lg:hidden 2xl:flex">
                {quickSearchKeys.map((key) => (
                    <kbd key={key} className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 bg-muted px-1 font-sans text-[0.6875rem] font-semibold text-muted-foreground">
                        {key}
                    </kbd>
                ))}
            </span>
        </button>
    );
}

function ButtonReloadUpdate({ className }: NavButtonProps) {
    const panelOutdated = useAtomValue(panelOutdatedAtom);
    if (!panelOutdated) return null;
    return (
        <button
            className={cn(navButtonClasses, 'group relative text-foreground sm:gap-2.5 sm:pl-3 sm:pr-1.5 lg:pl-3 lg:pr-1.5', className)}
            title="tfAdmin was updated. Reload to load the new version."
            onClick={() => window.location.reload()}
        >
            <span className="absolute right-2 top-2 size-2 rounded-full bg-success ring-2 ring-card sm:static sm:ring-0" />
            <RotateCwIcon className="h-6 w-6 sm:hidden" />
            <span className="hidden sm:inline">Update Ready</span>
            <span className="hidden sm:inline-flex h-7 items-center gap-1.5 rounded bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
                <RotateCwIcon className="size-3.5 transition-transform duration-300 group-hover:rotate-180" />
                Reload
            </span>
        </button>
    );
}

function ButtonToggleServerSheet({ className }: NavButtonProps) {
    const { setIsSheetOpen } = useServerSheet();
    return (
        <button
            className={cn(navButtonClasses, className)}
            title="Server Menu"
            onClick={() => setIsSheetOpen(true)}
        >
            <Monitor className="h-6 w-6 sm:h-5 sm:w-5" />
            <div className="hidden sm:flex flex-row min-w-max align-middle">
                Server
            </div>
        </button>
    );
}

function ButtonToggleGlobalMenu({ className }: NavButtonProps) {
    const { setIsSheetOpen } = useGlobalMenuSheet();
    return (
        <button
            className={cn(navButtonClasses, className)}
            title="Global Menu"
            onClick={() => setIsSheetOpen(true)}
        >
            <Menu className="h-6 w-6 sm:h-5 sm:w-5" />
            <div className="hidden sm:flex flex-row min-w-max">
                Menu
            </div>
        </button>
    );
}

function ButtonTogglePlayerlistSheet({ className }: NavButtonProps) {
    const { setIsSheetOpen } = usePlayerlistSheet();
    const playerCount = useAtomValue(playerCountAtom);

    return (
        <button
            className={cn(navButtonClasses, className)}
            title="Global Menu"
            onClick={() => setIsSheetOpen(true)}
        >
            <PersonStanding className="h-6 w-6 sm:h-5 sm:w-5" />
            <div className="hidden sm:flex flex-row min-w-max">
                Players
                <span className="hidden lg:inline-block font-mono">: {playerCount}</span>
            </div>
        </button>
    );
}

//Segmenting this into a component prevents full header rerenders
function AuthedHeaderFragment() {
    const { authData, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const { setAccountModalOpen } = useAccountModal();
    if (!authData) return null;
    const switchTheme = () => {
        if (theme === 'light') {
            setTheme('dark');
        } else {
            setTheme('light');
        }
    }
    const openAccountModal = () => {
        setAccountModalOpen(true);
    }
    const doLogout = () => logout();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="flex flex-row items-center gap-2 sm:gap-3 ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg">
                <span className="hidden xl:block text-muted-foreground">{authData.name}</span>
                <Avatar
                    className="w-11 h-11 sm:w-10 sm:h-10 rounded-md text-2xl 
                        transition-all focus-visible:outline-none
                        hover:border-zinc-500 hover:border"
                    username={authData.name}
                    profilePicture={authData.profilePicture}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {/* <DropdownMenuLabel>Your Account</DropdownMenuLabel>
                <DropdownMenuSeparator /> */}

                {/* Don't show theme selector if on NUI, as it is broken */}
                {/* TODO: remove this when remaking the ingame menu */}
                {window.txConsts.isWebInterface && (
                    <DropdownMenuItem className="cursor-pointer" onClick={switchTheme}>
                        {theme === 'light' ? <SunIcon className="mr-2 h-4 w-4" /> : <MoonIcon className="mr-2 h-4 w-4" />}
                        {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem className="cursor-pointer" onClick={openAccountModal}>
                    <KeyRoundIcon className="mr-2 h-4 w-4" />
                    Your Account
                </DropdownMenuItem>

                {/* Don't show logout if on NUI */}
                {window.txConsts.isWebInterface && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="cursor-pointer" onClick={doLogout}>
                            <LogOutIcon className="mr-2 h-4 w-4" />
                            Logout
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function Header() {
    return (
        <header className="sticky top-0 z-20 flex flex-col items-center justify-center
            border-b bg-card text-card-foreground border-card-background shadow-lg md:shadow-sm">
            <div className="h-14 lg:px-3 px-2 w-full max-w-[1920px] flex flex-row justify-between transition-all">
                <div className="flex flex-row items-center flex-grow gap-5 mr-5">
                    <div className="w-sidebar hidden xl:flex justify-center">
                        <NavLink href="/">
                            {/* <h2 className="text-4xl font-bold text-pink-500 saturate-150">Option XYZ</h2> */}
                            <LogoFullSquareGreen className="h-9 hover:scale-105 hover:brightness-110" />
                        </NavLink>
                    </div>
                    <NavLink href="/" className="hidden sm:max-xl:block">
                        <LogoSquareGreen className="h-8 w-8 lg:h-10 lg:w-10 hover:scale-105 hover:brightness-110" />
                    </NavLink>

                    <div className="lg:hidden">
                        <ServerTitle />
                    </div>
                    <nav className="hidden lg:block flex-grow">
                        <DesktopNavbar />
                    </nav>
                </div>

                <div className="flex flex-row items-center gap-2 sm:gap-3">
                    <ButtonReloadUpdate />
                    <ButtonQuickSearch />
                    <ButtonToggleServerSheet className="lg:hidden" />
                    <ButtonToggleGlobalMenu className="lg:hidden" />
                    <ButtonTogglePlayerlistSheet className="xl:hidden" />
                    <AuthedHeaderFragment />
                </div>
            </div>
        </header>
    );
}
