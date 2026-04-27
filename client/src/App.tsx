import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "@/pages/Dashboard";
import WalletDetail from "@/pages/WalletDetail";
import LiveFeed from "@/pages/LiveFeed";
import Signals from "@/pages/Signals";
import NotFound from "@/pages/not-found";

function Logo() {
  return (
    <svg aria-label="Polymarket Dashboard" viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" fillOpacity="0.15"/>
      <path d="M8 22 L8 10 L13 10 C16 10 18 12 18 15 C18 18 16 20 13 20 L11 20 L11 22 Z" 
            fill="hsl(var(--primary))" stroke="none"/>
      <path d="M19 16 L24 10 M24 10 L24 16 M24 10 L28 10" 
            stroke="hsl(var(--cyan))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="6" cy="26" r="1.5" fill="hsl(var(--green))"/>
      <circle cx="11" cy="26" r="1.5" fill="hsl(var(--green))"/>
      <circle cx="16" cy="26" r="1.5" fill="hsl(var(--yellow))"/>
    </svg>
  );
}

// Live signal count badge in nav
function SignalsNavItem() {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/signals/count"],
    refetchInterval: 15000,
  });
  const count = data?.count ?? 0;
  return (
    <span className="flex items-center gap-1.5">
      Signals
      {count > 0 && (
        <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-yellow text-background text-[9px] font-bold">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </span>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [location] = useLocation();
  const isActive = location === href || (href !== "/" && location.startsWith(href));
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
        isActive
          ? "bg-surface-3 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
      }`}
    >
      {children}
    </Link>
  );
}

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex items-center gap-4 h-full px-4 max-w-[1600px] mx-auto">
        <Link href="/" className="flex items-center gap-2.5 mr-4">
          <Logo />
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-foreground tracking-tight">PolyTrack</span>
            <span className="text-[10px] text-muted-foreground font-mono">Wallet Analytics</span>
          </div>
        </Link>

        <div className="flex items-center gap-1">
          <NavLink href="/">Dashboard</NavLink>
          <NavLink href="/sports-arb">🎯 Sports Arb</NavLink>
          <NavLink href="/signals">
            <SignalsNavItem />
          </NavLink>
          <NavLink href="/live">Live Feed</NavLink>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-2 border border-border">
            <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-live"></span>
            <span className="text-[11px] font-mono text-muted-foreground">LIVE</span>
          </div>
        </div>
      </div>
    </nav>
  );
}

function AppInner() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <div className="pt-14">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/wallet/:address" component={WalletDetail} />
          <Route path="/signals" component={Signals} />
          <Route path="/live" component={LiveFeed} />
          <Route path="/sports-arb" component={SportsArb} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppInner />
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
