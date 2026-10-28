import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Activity as ActivityIcon, AlertCircle, ArrowDownLeft, ArrowLeftRight, ArrowRight, Bell,
  Boxes, Building2, CalendarDays, Check, CheckCheck, ChevronDown,
  ChevronRight, CircleDollarSign, ClipboardCheck, ClipboardList, Clock3, FileText, HeartHandshake,
  Home as HomeIcon, MapPin, MessageSquare, PackagePlus, Plus, Receipt, RefreshCw, Send,
  Settings as SettingsIcon, ShieldCheck, ShoppingBasket, SlidersHorizontal,
  Users, Wallet, X, Paperclip, CheckCircle2
} from 'lucide-react';
import {
  useGetSession, useGetDashboard, useListHomes, useCreateHome, useGetHome, useUpdateHome,
  useGetSettings, useUpdateSettings, useListMembers, useAssignMember, useListExpenses,
  useCreateExpense, useReviewExpense, useListInventory, useCreateInventoryItem,
  useUpdateInventoryItem, useTransferInventory, useListBills, useCreateBill, useUpdateBill,
  useListIssues, useCreateIssue, useUpdateIssue, useAddIssueComment, useListReports,
  useSubmitWeeklyReport, useListNotifications, useMarkNotificationRead, useRequestUploadUrl,
  getGetSessionQueryKey, getGetDashboardQueryKey, getListHomesQueryKey, getGetHomeQueryKey, getGetSettingsQueryKey,
  getListMembersQueryKey, getListExpensesQueryKey, getListInventoryQueryKey,
  getListBillsQueryKey, getListIssuesQueryKey, getListReportsQueryKey,
  getListNotificationsQueryKey
} from '@workspace/api-client-react';
import type {
  Home, Expense, InventoryItem, Bill, Issue, WeeklyReport, Notification,
  HomeInput, ExpenseInput, InventoryInput, BillInput, IssueInput, IssueAttachment, WeeklyReportInput,
  MemberInput, OrganizationSettingsUpdate
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: false } }
});
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const money = (value?: number | null) => `KES ${(value ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const cap = (value?: string | null) => (value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

function useNotice() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return { message, notify: setMessage, toast: message ? <div role="status" className="toast-message" data-testid="status-notice">{message}</div> : null };
}

function Button({ children, onClick, variant = '', className = '', type = 'button', disabled = false, testId }: {
  children: ReactNode; onClick?: () => void; variant?: string; className?: string; type?: 'button' | 'submit'; disabled?: boolean; testId?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`btn ${variant} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>{children}</button>;
}
function IconButton({ children, onClick, label, testId }: { children: ReactNode; onClick?: () => void; label: string; testId: string }) {
  return <button className="icon-btn" type="button" onClick={onClick} aria-label={label} title={label} data-testid={testId}>{children}</button>;
}
function PageHead({ kicker, title, subtitle, action }: { kicker: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-head fade-in"><div><div className="page-kicker">{kicker}</div><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{action}</div>;
}
function Panel({ title, note, action, children, className = '' }: { title: string; note?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><h2 className="panel-title">{title}</h2>{note && <div className="panel-note">{note}</div>}</div>{action}</div>{children}</section>;
}
function Status({ value }: { value: string }) {
  const tone = ['urgent', 'overdue', 'rejected'].includes(value) ? 'urgent' : ['attention', 'high'].includes(value) ? 'warning' : value;
  return <span className={`status-pill ${tone}`} data-testid={`status-${value}`}>{cap(value)}</span>;
}
function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="panel loading-bars" aria-label="Loading"><div className="skeleton" style={{ width: '32%' }} />{Array.from({ length: rows }, (_, i) => <div key={i} className={`skeleton ${i === 0 ? 'large' : ''}`} />)}</div>;
}
function LoadError({ retry }: { retry: () => void }) {
  return <div className="panel empty-state"><div className="empty-icon"><AlertCircle size={22} /></div><div className="empty-title">Couldn’t load this view</div><p className="empty-copy">The latest home information is unavailable right now. Try again in a moment.</p><Button onClick={retry}><RefreshCw size={14} /> Try again</Button></div>;
}
function Empty({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><HeartHandshake size={22} /></div><div className="empty-title">{title}</div><p className="empty-copy">{copy}</p>{action}</div>;
}
function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title} data-testid="dialog-form"><header className="modal-head"><div><div className="modal-title">{title}</div>{description && <div className="modal-copy">{description}</div>}</div><IconButton label="Close dialog" testId="button-close-dialog" onClick={onClose}><X size={17} /></IconButton></header><div className="modal-body">{children}</div></section></div>;
}
function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <div className={`field ${full ? 'field-full' : ''}`}><label>{label}</label>{children}</div>;
}
function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { 'data-testid'?: string }) {
  return <input {...props} className={`input ${props.className || ''}`} data-testid={props['data-testid'] || 'input-form-field'} />;
}
function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { 'data-testid'?: string }) {
  return <textarea {...props} className={`textarea ${props.className || ''}`} data-testid={props['data-testid'] || 'input-form-field'} />;
}
function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { 'data-testid'?: string }) {
  return <select {...props} className={`select ${props.className || ''}`} data-testid={props['data-testid'] || 'select-form-field'} />;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><div className="brand-mark"><HeartHandshake size={19} /></div><div>Wema <small>{compact ? 'CARE OPERATIONS' : 'HOMES · PEOPLE · CARE'}</small></div></div>;
}

function PublicLanding() {
  const { isSignedIn } = useUser();
  const [, navigate] = useLocation();
  useEffect(() => { if (isSignedIn) navigate('/dashboard'); }, [isSignedIn, navigate]);
  return <main className="landing" data-testid="page-public-landing">
    <nav className="landing-nav"><div className="landing-brand"><div className="brand-mark"><HeartHandshake size={19} /></div>Wema</div><div className="top-actions"><Link className="btn btn-quiet" href="/sign-in">Sign in</Link><Link className="btn btn-primary" href="/sign-up">Get started <ArrowRight size={14} /></Link></div></nav>
    <section className="hero">
      <div className="fade-in"><div className="section-label">A steadier way to care for the details</div><h1>Good care needs <em>good systems.</em></h1><p className="hero-copy">One dependable workspace for the people running children’s homes across Nairobi. Keep budgets, supplies, bills and the small-but-important follow-through in view.</p><div className="top-actions"><Link href="/sign-up" className="btn btn-primary">Enter your workspace <ArrowRight size={15} /></Link><a href="#how-it-helps" className="btn">See how it works <ChevronDown size={14} /></a></div><div style={{ display: 'flex', gap: 18, marginTop: 26, color: '#75867b', fontSize: 11 }}><span><Check size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />Built around home teams</span><span><Check size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />KES-first operations</span></div></div>
      <div className="hero-art fade-in-2" aria-label="Illustration of a warm, welcoming children’s home"><div className="hero-sun" /><div className="hero-tag one"><strong>Care, made visible</strong>What needs attention today</div><div className="home-illustration"><div className="house-roof" /><div className="house-window left" /><div className="house-window right" /><div className="house-door" /></div><div className="hill hill-one" /><div className="hill hill-two" /><div className="hero-tag two"><strong>One shared picture</strong>For every home team</div></div>
    </section>
    <section className="landing-section" id="how-it-helps"><div className="section-inner"><div className="section-label">The day-to-day, in one place</div><h2 className="section-title">Less chasing updates. More time for people.</h2><p className="section-intro">Wema keeps the operational rhythm visible without turning care work into paperwork. Managers see what belongs to their home; leadership sees the whole picture.</p><div className="feature-grid" style={{ gridTemplateColumns: '1.1fr .9fr .9fr' }}><article className="feature-card" style={{ background: '#e8e8d7' }}><Wallet size={21} /><h3>Money that makes sense</h3><p>Track spend against each home’s budget, capture receipts and move approvals along with clear context.</p></article><article className="feature-card"><Boxes size={21} /><h3>Supplies without surprises</h3><p>Know what is running low and coordinate transfers before a home runs short.</p></article><article className="feature-card"><ClipboardCheck size={21} /><h3>Follow-through, together</h3><p>See reports, bills and open issues with owners and next steps in view.</p></article></div></div></section>
    <section className="landing-section feature-band"><div className="section-inner"><div className="section-label">Made for real home operations</div><h2 className="section-title">A clear rhythm for every week.</h2><p className="section-intro">From a manager’s first morning check-in to a CEO’s month-end review, the important things stay connected.</p><div className="feature-grid"><article className="feature-card"><CalendarDays size={20} /><h3>Start with today</h3><p>Surface pending approvals, due bills, stock alerts and unresolved issues in a calm daily overview.</p></article><article className="feature-card"><MapPin size={20} /><h3>Keep each home in context</h3><p>See capacity, occupancy, reporting and budgets at a glance, with a focused home profile behind it.</p></article><article className="feature-card"><ShieldCheck size={20} /><h3>Clear responsibility</h3><p>Assign home managers and set approval thresholds that reflect how your organization works.</p></article></div></div></section>
    <section className="landing-section"><div className="section-inner"><div className="landing-bottom"><div><div className="section-label">The work matters. The details do too.</div><h2>Bring the whole team into view.</h2><p className="section-intro">A workspace built to support the people who make a home feel steady.</p></div><Link className="btn btn-primary" href="/sign-up">Create your account <ArrowRight size={15} /></Link></div></div></section>
    <footer className="landing-footer"><span>Wema · Home operations</span><span>Made for care teams in Nairobi</span></footer>
  </main>;
}

function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const isIn = mode === 'sign-in';
  return <main className="auth-page">
    <aside className="auth-aside"><Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}><Brand /></Link><div className="auth-quote">“The best systems give people more room to <span>show up for each other.</span>”</div><div className="auth-mini">Wema · A shared workspace for home operations</div></aside>
    <div className="auth-area"><div className="auth-card"><div className="page-kicker">Your team’s workspace</div><h1>{isIn ? 'Welcome back.' : 'Let’s get started.'}</h1><p>{isIn ? 'Sign in to pick up where your home team left off.' : 'Create an account to join your organization’s care operations.'}</p>
      {isIn ? <SignIn path={`${BASE}/sign-in`} routing="path" signUpUrl={`${BASE}/sign-up`} appearance={{ variables: { colorPrimary: '#2b594c', colorForeground: '#29483e', colorBackground: '#fbf9f2', borderRadius: '10px', fontFamily: 'DM Sans, sans-serif' }, elements: { card: 'shadow-none border border-[#e4dfd3] bg-[#fbf9f3]', headerTitle: 'font-bold', formButtonPrimary: 'bg-[#2b594c] hover:bg-[#20483d]' } }} /> : <SignUp path={`${BASE}/sign-up`} routing="path" signInUrl={`${BASE}/sign-in`} appearance={{ variables: { colorPrimary: '#2b594c', colorForeground: '#29483e', colorBackground: '#fbf9f2', borderRadius: '10px', fontFamily: 'DM Sans, sans-serif' }, elements: { card: 'shadow-none border border-[#e4dfd3] bg-[#fbf9f3]', headerTitle: 'font-bold', formButtonPrimary: 'bg-[#2b594c] hover:bg-[#20483d]' } }} />}
      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: '#869087' }}>{isIn ? <>New to the workspace? <Link href="/sign-up" style={{ color: '#2b594c', fontWeight: 700 }}>Create an account</Link></> : <>Already have an account? <Link href="/sign-in" style={{ color: '#2b594c', fontWeight: 700 }}>Sign in</Link></>}</div>
    </div></div>
  </main>;
}

const NAV = [
  { label: 'Today', path: '/dashboard', icon: HomeIcon },
  { label: 'Homes', path: '/homes', icon: Building2 },
  { label: 'Expenses', path: '/expenses', icon: CircleDollarSign },
  { label: 'Inventory', path: '/inventory', icon: Boxes },
  { label: 'Bills', path: '/bills', icon: Receipt },
  { label: 'Issues', path: '/issues', icon: AlertCircle },
  { label: 'Weekly reports', path: '/reports', icon: FileText },
  { label: 'Settings', path: '/settings', icon: SettingsIcon }
];

function IdentityCacheBoundary({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const cache = useQueryClient();
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    const next = user?.id ?? null;
    if (previousUser.current !== null && previousUser.current !== next) cache.clear();
    previousUser.current = next;
  }, [user?.id, isLoaded, cache]);
  return <>{children}</>;
}

function AppFrame({ children, title, isDemo }: { children: ReactNode; title: string; isDemo?: boolean }) {
  const { user } = useUser();
  const [path] = useLocation();
  const notifications = useListNotifications();
  const markRead = useMarkNotificationRead();
  const cache = useQueryClient();
  const [showNotices, setShowNotices] = useState(false);
  const { notify, toast } = useNotice();
  const unread = notifications.data?.filter((notification) => !notification.read).length ?? 0;
  const readNotification = (item: Notification) => {
    if (item.read) return;
    markRead.mutate({ id: item.id }, { onSuccess: () => cache.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) });
  };
  return <div className="app-shell">
    <aside className="sidebar"><Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}><Brand compact /></Link>
      <div className="nav-label">Workspace</div><nav>{NAV.map(({ label, path: href, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${path === href || (href === '/homes' && path.startsWith('/homes/')) ? 'active' : ''}`} data-testid={`link-nav-${href.slice(1)}`}><Icon size={16} /><span>{label}</span></Link>)}</nav>
      <div className="side-bottom"><div className="user-mini"><div className="user-avatar">{(user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0] || 'W').toUpperCase()}</div><span>{user?.fullName || user?.emailAddresses?.[0]?.emailAddress || 'Team member'}</span></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div><div className="top-eyebrow">Wema · Home operations {isDemo && <span style={{ marginLeft: 8, padding: '3px 7px', borderRadius: 999, background: '#f1e5c9', color: '#775b26', fontSize: 9, fontWeight: 700, letterSpacing: '.08em' }}>DEMO DATA</span>}</div><div className="top-title">{title}</div></div><div className="top-actions"><div style={{ position: 'relative' }}><IconButton label="Notifications" testId="button-notifications" onClick={() => setShowNotices((value) => !value)}><Bell size={16} />{unread > 0 && <span className="unread-dot" />}</IconButton>{showNotices && <div className="panel" style={{ position: 'absolute', right: 0, top: 45, width: 'min(370px, calc(100vw - 30px))', zIndex: 30, boxShadow: '0 14px 35px #203f3722' }}><div className="panel-head"><div><h2 className="panel-title">Your notifications</h2><div className="panel-note">{unread} unread updates</div></div><IconButton label="Close notifications" testId="button-close-notifications" onClick={() => setShowNotices(false)}><X size={15} /></IconButton></div><div className="notification-list">{notifications.isLoading ? <div className="skeleton" /> : (notifications.data || []).length ? notifications.data?.slice(0, 5).map((item) => <Link href={item.href || '/dashboard'} key={item.id} onClick={() => { readNotification(item); setShowNotices(false); }} className={`notification-row ${item.read ? 'read' : ''}`} style={{ textDecoration: 'none' }} data-testid={`notification-${item.id}`}><span className="notification-dot" /><div><div className="notification-title">{item.title}</div><div className="notification-message">{item.message}</div></div><span className="table-muted">{dateLabel(item.createdAt)}</span></Link>) : <Empty title="All caught up" copy="New updates for your workspace will show here." />}</div><div style={{ padding: '0 20px 15px' }}><Button className="btn-sm" onClick={() => { (notifications.data || []).filter((item) => !item.read).forEach(readNotification); notify('Unread updates marked as read'); }}>Mark all read <CheckCheck size={13} /></Button></div></div>}</div></div></header>
      <main className="main-content">{children}</main>
    </div>{toast}
  </div>;
}

function SignedInGate({ children, title }: { children: (session: any) => ReactNode; title: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const session = useGetSession({ query: { enabled: !!isSignedIn, queryKey: getGetSessionQueryKey() } });
  if (!isLoaded || (isSignedIn && session.isLoading)) return <div className="min-h-[100dvh] grid place-items-center p-5"><div style={{ width: 'min(500px,100%)' }}><div className="skeleton" style={{ height: 32, marginBottom: 18 }} /><div className="skeleton large" /></div></div>;
  if (!isSignedIn) return <AuthScreen mode="sign-in" />;
  if (session.isError) return <div className="min-h-[100dvh] grid place-items-center p-5"><div style={{ width: 'min(500px,100%)' }}><LoadError retry={() => session.refetch()} /></div></div>;
  const current = session.data;
  return <AppFrame title={title} isDemo={current?.isDemo}>{current?.role === 'unassigned' ? <UnassignedState email={current.email} /> : children(current)}</AppFrame>;
}
function UnassignedState({ email }: { email?: string }) {
  return <div style={{ maxWidth: 820, margin: '6vh auto' }} className="panel fade-in"><div style={{ padding: '36px 34px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 23, alignItems: 'start' }}><div className="empty-icon" style={{ width: 60, height: 60, margin: 0 }}><Users size={27} /></div><div><div className="page-kicker">Account access</div><h1 className="page-title" style={{ fontSize: 29 }}>Your place in the team is being set up.</h1><p style={{ color: '#718076', fontSize: 13, lineHeight: 1.65, maxWidth: 580 }}>You’re signed in as <strong>{email || 'a team member'}</strong>, but your account has not been assigned a role or home yet. An organization administrator can assign your role from Settings. Once assigned, your home operations will appear here.</p><div className="panel" style={{ marginTop: 21, padding: 15, display: 'flex', gap: 11, alignItems: 'center', color: '#5e7467', fontSize: 12 }}><ShieldCheck size={18} /> Your access stays private until an administrator connects you to a home.</div></div></div></div>;
}

function DashboardPage({ session }: { session: any }) {
  const query = useGetDashboard();
  const homesQuery = useListHomes();
  const [path, navigate] = useLocation();
  void path;
  if (query.isLoading) return <><PageHead kicker="Your day, in one view" title="Good morning." subtitle="A steady picture of what needs attention across your homes." /><div className="metric-grid">{[1, 2, 3, 4].map((i) => <div key={i} className="panel metric"><div className="skeleton" /><div className="skeleton" style={{ marginTop: 20, width: '55%', height: 29 }} /></div>)}</div><Loading /></>;
  if (query.isError || !query.data) return <LoadError retry={() => query.refetch()} />;
  const dashboard = query.data;
  const totalBudget = dashboard.monthBudget || 0;
  const spendPct = totalBudget ? Math.min(100, dashboard.monthSpend / totalBudget * 100) : 0;
  const trendMax = Math.max(1, ...dashboard.spendTrend.flatMap((point) => [point.spend, point.budget]));
  return <div className="fade-in">
    <PageHead kicker="Your day, in one view" title={`Good morning${session?.homeName ? `, ${session.homeName}` : ''}.`} subtitle="A steady picture of what needs attention across your homes." action={<Link href="/issues" className="btn btn-primary"><Plus size={15} /> Log an issue</Link>} />
    <div className="metric-grid">
      <div className="panel metric"><Wallet size={17} className="metric-icon" /><div className="metric-label">Spend this month</div><div className="metric-value">{money(dashboard.monthSpend)}</div><div className="metric-foot">{spendPct.toFixed(0)}% of {money(totalBudget)} budget</div></div>
      <div className="panel metric"><ClipboardCheck size={17} className="metric-icon" /><div className="metric-label">Approvals waiting</div><div className="metric-value">{dashboard.pendingApprovals}</div><div className="metric-foot">Expenses ready for a decision</div></div>
      <div className="panel metric"><AlertCircle size={17} className="metric-icon" /><div className="metric-label">Open issues</div><div className="metric-value">{dashboard.openIssues}</div><div className="metric-foot">Items needing follow-through</div></div>
      <div className="panel metric"><ClipboardList size={17} className="metric-icon" /><div className="metric-label">Reports in</div><div className="metric-value">{dashboard.reportCompliance}%</div><div className="metric-foot">Weekly reporting compliance</div></div>
    </div>
    <div className="dashboard-grid">
      <div className="stack">
        <Panel title="Spend against budget" note="Monthly organization view" action={<div className="legend"><span><i style={{ background: '#4c8770' }} />Spend</span><span><i style={{ background: '#e8d6b3' }} />Budget</span></div>}>
          {dashboard.spendTrend.length ? <div className="trend-chart" data-testid="chart-spend-trend">{dashboard.spendTrend.map((point) => <div className="trend-col" key={point.label}><div className="trend-bars"><div className="trend-bar trend-spend" title={`Spend ${money(point.spend)}`} style={{ height: `${Math.max(4, point.spend / trendMax * 100)}%` }} /><div className="trend-bar trend-budget" title={`Budget ${money(point.budget)}`} style={{ height: `${Math.max(4, point.budget / trendMax * 100)}%` }} /></div><span className="trend-label">{point.label}</span></div>)}</div> : <Empty title="No spend trend yet" copy="Once expenses are recorded, this view will show how spending is tracking against budget." />}</Panel>
        <Panel title="Homes at a glance" note={`${dashboard.homes.length} homes in your view`} action={<Link href="/homes" className="btn btn-sm">All homes <ArrowRight size={13} /></Link>} className="scroll-panel">
          {dashboard.homes.length ? <div className="home-list">{dashboard.homes.slice(0, 4).map((home) => <HomeRow home={home} key={home.id} />)}</div> : <Empty title="No homes assigned" copy="Homes available to your account will appear here." />}</Panel>
      </div>
      <div className="stack">
        <Panel title="Needs attention" note="A few things to keep moving">
          <div className="activity-list">
            <AttentionLink href="/expenses" icon={<ClipboardCheck size={14} />} label="Expense approvals" value={dashboard.pendingApprovals} note="Review submitted expenses" />
            <AttentionLink href="/issues" icon={<AlertCircle size={14} />} label="Open issues" value={dashboard.openIssues} note="Check on outstanding follow-up" />
            <AttentionLink href="/inventory" icon={<ShoppingBasket size={14} />} label="Low stock items" value={dashboard.lowStock} note="Restock before a home runs short" />
            <AttentionLink href="/bills" icon={<Receipt size={14} />} label="Bills coming up" value={dashboard.upcomingBills} note="Check due dates and recurring charges" />
          </div></Panel>
        <Panel title="Recent activity" note="Latest updates from your homes" action={<ActivityIcon size={15} color="#819187" />}>
          {dashboard.recentActivity.length ? <div className="activity-list">{dashboard.recentActivity.slice(0, 5).map((activity) => <div className="activity-row" key={activity.id} data-testid={`activity-${activity.id}`}><div className="activity-mark"><ActivityIcon size={13} /></div><div><div className="activity-text">{activity.title}</div><div className="activity-detail">{activity.detail}</div></div><span className="activity-time">{new Date(activity.timestamp).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span></div>)}</div> : <Empty title="A quiet moment" copy="Home updates will gather here as your team records the week." />}</Panel>
      </div>
    </div>
    {homesQuery.isError && <div style={{ marginTop: 15, color: '#8e5c43', fontSize: 11 }}>The home directory could not be refreshed. <button className="btn btn-sm" onClick={() => homesQuery.refetch()}>Retry</button></div>}
  </div>;
}
function AttentionLink({ href, icon, label, value, note }: { href: string; icon: ReactNode; label: string; value: number; note: string }) {
  return <Link href={href} className="activity-row" style={{ textDecoration: 'none' }} data-testid={`link-attention-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="activity-mark">{icon}</div><div style={{ flex: 1 }}><div className="activity-text">{label}</div><div className="activity-detail">{note}</div></div><span className="mono">{value}</span><ChevronRight size={14} color="#9ca59c" /></Link>;
}
function HomeRow({ home }: { home: Home }) {
  const occupancy = home.capacity ? Math.min(100, home.occupancy / home.capacity * 100) : 0;
  return <Link href={`/homes/${home.id}`} className="home-row" data-testid={`card-home-${home.id}`}><div><div className="home-name">{home.name}</div><div className="home-location"><MapPin size={10} style={{ display: 'inline', marginRight: 3 }} />{home.location}</div></div><div><div className="mono">{home.occupancy} / {home.capacity}</div><div className="progress-track"><div className="progress-fill" style={{ width: `${occupancy}%` }} /></div></div><div><div className="mono">{money(home.spend)} <span style={{ color: '#929b91' }}>of {money(home.monthlyBudget)}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${home.monthlyBudget ? Math.min(100, home.spend / home.monthlyBudget * 100) : 0}%`, background: home.spend > home.monthlyBudget ? '#ce8261' : undefined }} /></div></div><Status value={home.status} /><ChevronRight size={15} color="#9ba59b" /></Link>;
}

function HomesPage({ session }: { session: any }) {
  const query = useListHomes();
  const createHome = useCreateHome();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const items = useMemo(() => (query.data || []).filter((home) => `${home.name} ${home.location} ${home.managerName}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const data: HomeInput = { name: String(form.get('name')), location: String(form.get('location')), managerName: String(form.get('managerName')), capacity: Number(form.get('capacity')), monthlyBudget: Number(form.get('monthlyBudget')) };
    createHome.mutate({ data }, { onSuccess: () => { cache.invalidateQueries({ queryKey: getListHomesQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setOpen(false); notify('Home added to the directory'); }, onError: () => notify('Could not add the home. Check the details and try again.') });
  };
  return <>{toast}<PageHead kicker="Where care happens" title="Homes" subtitle="The people, capacity and operating picture for each home." action={session?.role === 'ceo' ? <Button variant="btn-primary" onClick={() => setOpen(true)} testId="button-add-home"><Plus size={15} /> Add a home</Button> : undefined} />
    <div className="panel" style={{ marginBottom: 16, padding: '12px 15px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><div className="filter-row"><SlidersHorizontal size={15} color="#839087" /><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a home or manager" style={{ width: 240, padding: '8px 10px' }} data-testid="input-search-homes" /></div><span className="table-muted">{items.length} homes</span></div>
    {query.isLoading ? <Loading /> : query.isError ? <LoadError retry={() => query.refetch()} /> : <Panel title="Home directory" note="Operational status and monthly budget" className="scroll-panel">{items.length ? <div className="home-list">{items.map((home) => <HomeRow key={home.id} home={home} />)}</div> : <Empty title="No matching homes" copy={search ? 'Try another name, location or manager.' : 'Your organization’s homes will appear here once they are added.'} />}</Panel>}
    {open && <Modal title="Add a home" description="Set up the essentials. You can refine the home profile later." onClose={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Home name"><TextInput name="name" required placeholder="e.g. Mwangaza House" /></Field><Field label="Location"><TextInput name="location" required placeholder="Neighbourhood, Nairobi" /></Field><Field label="Manager name"><TextInput name="managerName" required placeholder="Home manager" /></Field><Field label="Capacity"><TextInput name="capacity" type="number" min="1" required placeholder="12" /></Field><Field label="Monthly budget (KES)" full><TextInput name="monthlyBudget" type="number" min="0" required placeholder="240000" /></Field></div><div className="modal-foot"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={createHome.isPending}>{createHome.isPending ? 'Adding…' : 'Add home'} <ArrowRight size={14} /></Button></div></form></Modal>}
  </>;
}

function HomeDetailPage({ session }: { session: any }) {
  const params = useParams<{ id: string }>();
  const query = useGetHome(params.id || '', { query: { enabled: !!params.id, queryKey: getGetHomeQueryKey(params.id || '') } });
  const update = useUpdateHome();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [editing, setEditing] = useState(false);
  if (query.isLoading) return <><PageHead kicker="Home profile" title="Loading home…" /><Loading /></>;
  if (query.isError || !query.data) return <LoadError retry={() => query.refetch()} />;
  const home = query.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    update.mutate({ id: home.id, data: { name: String(form.get('name')), location: String(form.get('location')), managerName: String(form.get('managerName')), capacity: Number(form.get('capacity')), monthlyBudget: Number(form.get('monthlyBudget')), approvalThreshold: form.get('approvalThreshold') === '' ? null : Number(form.get('approvalThreshold')) } }, {
      onSuccess: () => { cache.invalidateQueries({ queryKey: getGetHomeQueryKey(home.id) }); cache.invalidateQueries({ queryKey: getListHomesQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setEditing(false); notify('Home profile updated'); },
      onError: () => notify('Could not save changes. Please try again.')
    });
  };
  const occupancy = home.capacity ? Math.round(home.occupancy / home.capacity * 100) : 0;
  return <>{toast}<PageHead kicker="Home profile" title={home.name} subtitle={`${home.location} · Managed by ${home.managerName}`} action={<><Link href="/homes" className="btn"><ArrowDownLeft size={14} /> Homes</Link>{session?.role === 'ceo' && <Button onClick={() => setEditing(true)} variant="btn-primary" testId="button-edit-home"><SettingsIcon size={14} /> Edit home</Button>}</>} />
    <div className="metric-grid"><div className="panel metric"><Users size={17} className="metric-icon" /><div className="metric-label">Occupancy</div><div className="metric-value">{home.occupancy} <span style={{ fontSize: 15, color: '#879187' }}>/ {home.capacity}</span></div><div className="metric-foot">{occupancy}% of home capacity</div></div><div className="panel metric"><Wallet size={17} className="metric-icon" /><div className="metric-label">Month-to-date spend</div><div className="metric-value">{money(home.spend)}</div><div className="metric-foot">Budget {money(home.monthlyBudget)}</div></div><div className="panel metric"><ClipboardCheck size={17} className="metric-icon" /><div className="metric-label">Weekly report</div><div className="metric-value" style={{ fontSize: 21 }}>{home.reportSubmitted ? 'Submitted' : 'Due'}</div><div className="metric-foot">Current reporting period</div></div><div className="panel metric"><ShieldCheck size={17} className="metric-icon" /><div className="metric-label">Home status</div><div style={{ marginTop: 13 }}><Status value={home.status} /></div><div className="metric-foot">Based on current home operations</div></div></div>
    <div className="dashboard-grid"><Panel title="Home details" note="A shared reference for the team"><div className="activity-list"><DetailLine label="Location" value={home.location} /><DetailLine label="Home manager" value={home.managerName} /><DetailLine label="Capacity" value={`${home.occupancy} residents of ${home.capacity}`} /><DetailLine label="Monthly budget" value={money(home.monthlyBudget)} /><DetailLine label="Approval threshold" value={home.approvalThreshold == null ? 'Organization default' : money(home.approvalThreshold)} /></div></Panel><Panel title="Budget pace" note="This month"><div style={{ padding: 21 }}><div style={{ display: 'flex', justifyContent: 'space-between', color: '#738177', fontSize: 11 }}><span>Spent</span><span>{home.monthlyBudget ? Math.round(home.spend / home.monthlyBudget * 100) : 0}%</span></div><div className="progress-track" style={{ height: 10, marginTop: 10 }}><div className="progress-fill" style={{ width: `${home.monthlyBudget ? Math.min(100, home.spend / home.monthlyBudget * 100) : 0}%`, height: '100%' }} /></div><div style={{ font: '700 23px var(--app-font-serif)', color: '#2b4e42', marginTop: 17 }}>{money(Math.max(0, home.monthlyBudget - home.spend))}</div><div className="table-muted">remaining in this month’s budget</div><div style={{ marginTop: 24 }}><Link href="/expenses" className="btn btn-primary">View expenses <ArrowRight size={14} /></Link></div></div></Panel></div>
    {editing && <Modal title="Edit home profile" description="Keep the operating details current for your team." onClose={() => setEditing(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Home name"><TextInput name="name" required defaultValue={home.name} /></Field><Field label="Location"><TextInput name="location" required defaultValue={home.location} /></Field><Field label="Manager name"><TextInput name="managerName" required defaultValue={home.managerName} /></Field><Field label="Capacity"><TextInput name="capacity" type="number" min="1" required defaultValue={home.capacity} /></Field><Field label="Monthly budget (KES)"><TextInput name="monthlyBudget" type="number" min="0" required defaultValue={home.monthlyBudget} /></Field><Field label="Approval override (KES)"><TextInput name="approvalThreshold" type="number" min="0" defaultValue={home.approvalThreshold ?? ''} placeholder="Use organization default" /></Field></div><div className="modal-foot"><Button onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</Button></div></form></Modal>}
  </>;
}
function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="activity-row" style={{ justifyContent: 'space-between' }}><span className="table-muted">{label}</span><strong style={{ fontSize: 12, color: '#39574a' }}>{value}</strong></div>;
}

function ExpensesPage({ session }: { session: any }) {
  const query = useListExpenses();
  const homes = useListHomes();
  const create = useCreateExpense();
  const review = useReviewExpense();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [homeFilter, setHomeFilter] = useState('');
  const rows = useMemo(() => (query.data || []).filter((expense) => (filter === 'all' || expense.status === filter) && (!homeFilter || expense.homeId === homeFilter)), [query.data, filter, homeFilter]);
  const invalidate = () => { cache.invalidateQueries({ queryKey: getListExpensesQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); cache.invalidateQueries({ queryKey: getListHomesQueryKey() }); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const data: ExpenseInput = { homeId: String(form.get('homeId')), category: String(form.get('category')), description: String(form.get('description')), amount: Number(form.get('amount')), date: String(form.get('date')) };
    create.mutate({ data }, { onSuccess: () => { invalidate(); setOpen(false); notify('Expense submitted for the home team'); }, onError: () => notify('Expense could not be submitted. Please try again.') });
  };
  const decide = (item: Expense, decision: 'approved' | 'rejected') => review.mutate({ id: item.id, data: { decision } }, { onSuccess: () => { invalidate(); notify(`Expense ${decision}`); }, onError: () => notify('Could not update this expense.') });
  return <>{toast}<PageHead kicker="Everyday spending" title="Expenses" subtitle="Record costs, keep approval context together and see the month taking shape." action={<Button variant="btn-primary" onClick={() => setOpen(true)} testId="button-new-expense"><Plus size={15} /> Record expense</Button>} />
    <div className="metric-grid"><div className="panel metric"><CircleDollarSign size={17} className="metric-icon" /><div className="metric-label">Recorded expenses</div><div className="metric-value">{query.data?.length ?? '—'}</div><div className="metric-foot">Across accessible homes</div></div><div className="panel metric"><ClipboardCheck size={17} className="metric-icon" /><div className="metric-label">Pending review</div><div className="metric-value">{query.data?.filter((item) => item.status === 'pending').length ?? '—'}</div><div className="metric-foot">Waiting for an approval decision</div></div><div className="panel metric"><Wallet size={17} className="metric-icon" /><div className="metric-label">Approved spend</div><div className="metric-value" style={{ fontSize: 21 }}>{money(query.data?.filter((item) => item.status === 'approved').reduce((sum, item) => sum + item.amount, 0))}</div><div className="metric-foot">Based on recorded expenses</div></div><div className="panel metric"><ShieldCheck size={17} className="metric-icon" /><div className="metric-label">Your approval limit</div><div className="metric-value" style={{ fontSize: 21 }}>{money(session?.threshold)}</div><div className="metric-foot">Organization default threshold</div></div></div>
    <Panel title="Expense register" note="Review and follow each submission" action={<div className="filter-row"><Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 130, padding: '7px 9px' }} data-testid="select-expense-status"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select><Select value={homeFilter} onChange={(e) => setHomeFilter(e.target.value)} style={{ width: 150, padding: '7px 9px' }} data-testid="select-expense-home"><option value="">All homes</option>{(homes.data || []).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></div>}>
      {query.isLoading ? <Loading /> : query.isError ? <LoadError retry={() => query.refetch()} /> : rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Expense</th><th>Home</th><th>Date & submitted by</th><th>Amount</th><th>Status</th><th>Review</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id} data-testid={`row-expense-${item.id}`}><td><div className="data-title">{item.description}</div><div className="data-small">{item.category}</div></td><td>{item.homeName}</td><td>{dateLabel(item.date)}<div className="data-small">{item.submittedBy}</div></td><td className="mono">{money(item.amount)}</td><td><Status value={item.status} />{item.approvalRequired && <div className="data-small">Approval required</div>}</td><td>{item.status === 'pending' && session?.role === 'ceo' ? <div className="table-actions"><Button className="btn-sm" variant="btn-primary" onClick={() => decide(item, 'approved')} disabled={review.isPending} testId={`button-approve-expense-${item.id}`}><Check size={12} /> Approve</Button><Button className="btn-sm btn-danger" onClick={() => decide(item, 'rejected')} disabled={review.isPending} testId={`button-reject-expense-${item.id}`}>Decline</Button></div> : <span className="table-muted">{item.status === 'pending' ? 'Awaiting review' : '—'}</span>}</td></tr>)}</tbody></table></div> : <Empty title="No expenses in this view" copy="Submitted home expenses will appear here, ready to be followed through." />}</Panel>
    {open && <Modal title="Record an expense" description="Add the cost to the correct home so it lands in the right budget." onClose={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Home"><Select name="homeId" required defaultValue={session?.homeId || ''}><option value="" disabled>Select a home</option>{(homes.data || []).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></Field><Field label="Category"><Select name="category" required defaultValue=""><option value="" disabled>Choose category</option>{['Food', 'Household', 'Education', 'Health', 'Transport', 'Utilities', 'Other'].map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field><Field label="Description" full><TextInput name="description" required placeholder="What was purchased or paid for?" /></Field><Field label="Amount (KES)"><TextInput name="amount" type="number" min="1" required placeholder="4,500" /></Field><Field label="Date"><TextInput name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field></div><div className="modal-foot"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={create.isPending}>{create.isPending ? 'Submitting…' : 'Submit expense'} <Send size={14} /></Button></div></form></Modal>}
  </>;
}

function InventoryPage({ session }: { session: any }) {
  const query = useListInventory();
  const homes = useListHomes();
  const create = useCreateInventoryItem();
  const update = useUpdateInventoryItem();
  const transfer = useTransferInventory();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [open, setOpen] = useState(false);
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const [filter, setFilter] = useState('all');
  const lowStock = (query.data || []).filter((item) => item.quantity <= item.lowStockAt);
  const rows = useMemo(() => (query.data || []).filter((item) => filter === 'all' || (filter === 'low' ? item.quantity <= item.lowStockAt : item.homeId === filter)), [query.data, filter]);
  const invalidate = () => { cache.invalidateQueries({ queryKey: getListInventoryQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const data: InventoryInput = { homeId: String(form.get('homeId')), name: String(form.get('name')), category: String(form.get('category')), quantity: Number(form.get('quantity')), unit: String(form.get('unit')), unitCost: Number(form.get('unitCost')), lowStockAt: Number(form.get('lowStockAt')) };
    create.mutate({ data }, { onSuccess: () => { invalidate(); setOpen(false); notify('Supply added to inventory'); }, onError: () => notify('Could not add this supply.') });
  };
  const changeCount = (item: InventoryItem) => {
    const raw = window.prompt(`Update quantity for ${item.name}`, String(item.quantity));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) { notify('Enter a valid quantity of zero or more.'); return; }
    update.mutate({ id: item.id, data: { quantity: amount } }, { onSuccess: () => { invalidate(); notify('Inventory count updated'); }, onError: () => notify('Could not update inventory count.') });
  };
  const submitTransfer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!transferItem) return;
    const form = new FormData(event.currentTarget);
    transfer.mutate({ data: { itemId: transferItem.id, destinationHomeId: String(form.get('destinationHomeId')), quantity: Number(form.get('quantity')) } }, { onSuccess: () => { invalidate(); setTransferItem(null); notify('Supply transfer recorded'); }, onError: () => notify('Could not complete the transfer.') });
  };
  return <>{toast}<PageHead kicker="What each home has on hand" title="Inventory" subtitle="Keep household supplies visible, track low stock and move items where they are needed." action={<Button variant="btn-primary" onClick={() => setOpen(true)} testId="button-add-inventory"><PackagePlus size={15} /> Add supply</Button>} />
    <div className="metric-grid"><div className="panel metric"><Boxes size={17} className="metric-icon" /><div className="metric-label">Tracked supplies</div><div className="metric-value">{query.data?.length ?? '—'}</div><div className="metric-foot">Across accessible homes</div></div><div className="panel metric"><ShoppingBasket size={17} className="metric-icon" /><div className="metric-label">Low stock</div><div className="metric-value">{query.data ? lowStock.length : '—'}</div><div className="metric-foot">At or below the restock point</div></div><div className="panel metric"><Building2 size={17} className="metric-icon" /><div className="metric-label">Homes in view</div><div className="metric-value">{homes.data?.length ?? '—'}</div><div className="metric-foot">Where supplies are tracked</div></div><div className="panel metric"><ArrowLeftRight size={17} className="metric-icon" /><div className="metric-label">Transfer with care</div><div className="metric-value" style={{ fontSize: 19 }}>Share stock</div><div className="metric-foot">Move stock between homes</div></div></div>
    <Panel title="Supply register" note="Quantity and restock threshold by home" action={<Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 165, padding: '7px 9px' }} data-testid="select-inventory-filter"><option value="all">All supplies</option><option value="low">Low stock only</option>{(homes.data || []).map((home) => <option value={home.id} key={home.id}>{home.name}</option>)}</Select>}>
      {query.isLoading ? <Loading /> : query.isError ? <LoadError retry={() => query.refetch()} /> : rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Supply</th><th>Home</th><th>Category</th><th>On hand</th><th>Unit cost</th><th>Stock status</th><th>Actions</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id} data-testid={`row-inventory-${item.id}`}><td><div className="data-title">{item.name}</div><div className="data-small">Updated {dateLabel(item.updatedAt)}</div></td><td>{item.homeName}</td><td>{item.category}</td><td className="mono">{item.quantity} {item.unit}<div className="data-small">Restock at {item.lowStockAt}</div></td><td className="mono">{money(item.unitCost)}</td><td>{item.quantity <= item.lowStockAt ? <Status value="attention" /> : <Status value="good" />}</td><td><div className="table-actions"><Button className="btn-sm" onClick={() => changeCount(item)} testId={`button-update-stock-${item.id}`}>Update count</Button><Button className="btn-sm" onClick={() => setTransferItem(item)} testId={`button-transfer-stock-${item.id}`}><ArrowLeftRight size={12} /> Transfer</Button></div></td></tr>)}</tbody></table></div> : <Empty title="No supplies recorded" copy="Start a shared stock list for a home. Low-stock reminders will use the thresholds you set." />}</Panel>
    {open && <Modal title="Add a supply" description="Record an item and the point at which your team should restock it." onClose={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Home"><Select name="homeId" required defaultValue={session?.homeId || ''}><option value="" disabled>Select a home</option>{(homes.data || []).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></Field><Field label="Supply name"><TextInput name="name" required placeholder="Cooking oil" /></Field><Field label="Category"><TextInput name="category" required placeholder="Food, household…" /></Field><Field label="Quantity"><TextInput name="quantity" type="number" min="0" required placeholder="5" /></Field><Field label="Unit"><TextInput name="unit" required placeholder="litres, boxes, packs" /></Field><Field label="Unit cost (KES)"><TextInput name="unitCost" type="number" min="0" required placeholder="480" /></Field><Field label="Restock at"><TextInput name="lowStockAt" type="number" min="0" required placeholder="2" /></Field></div><div className="modal-foot"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add supply'}</Button></div></form></Modal>}
    {transferItem && <Modal title={`Transfer ${transferItem.name}`} description={`Moving stock from ${transferItem.homeName} to another home.`} onClose={() => setTransferItem(null)}><form onSubmit={submitTransfer}><div className="form-grid"><Field label="Destination home" full><Select name="destinationHomeId" required defaultValue=""><option value="" disabled>Select a different home</option>{(homes.data || []).filter((home) => home.id !== transferItem.homeId).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></Field><Field label={`Quantity (${transferItem.unit})`} full><TextInput name="quantity" type="number" min="1" max={transferItem.quantity} required placeholder="1" /></Field></div><div className="modal-foot"><Button onClick={() => setTransferItem(null)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={transfer.isPending}>{transfer.isPending ? 'Transferring…' : 'Record transfer'} <ArrowLeftRight size={14} /></Button></div></form></Modal>}
  </>;
}

function BillsPage({ session }: { session: any }) {
  const query = useListBills();
  const homes = useListHomes();
  const create = useCreateBill();
  const update = useUpdateBill();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => (query.data || []).filter((bill) => filter === 'all' || bill.status === filter), [query.data, filter]);
  const invalidate = () => { cache.invalidateQueries({ queryKey: getListBillsQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const data: BillInput = { homeId: String(form.get('homeId')), name: String(form.get('name')), vendor: String(form.get('vendor')), amount: Number(form.get('amount')), dueDate: String(form.get('dueDate')), frequency: String(form.get('frequency')) as BillInput['frequency'] };
    create.mutate({ data }, { onSuccess: () => { invalidate(); setOpen(false); notify('Recurring charge added'); }, onError: () => notify('Could not add this bill.') });
  };
  const changeStatus = (bill: Bill, status: 'paid' | 'upcoming') => update.mutate({ id: bill.id, data: { status } }, { onSuccess: () => { invalidate(); notify(status === 'paid' ? 'Bill marked as paid' : 'Bill status updated'); }, onError: () => notify('Could not update this bill.') });
  return <>{toast}<PageHead kicker="Recurring costs, kept visible" title="Bills" subtitle="Stay ahead of household charges and keep due dates connected to each home." action={<Button variant="btn-primary" onClick={() => setOpen(true)} testId="button-add-bill"><Plus size={15} /> Add a bill</Button>} />
    <div className="metric-grid"><div className="panel metric"><Receipt size={17} className="metric-icon" /><div className="metric-label">Tracked bills</div><div className="metric-value">{query.data?.length ?? '—'}</div><div className="metric-foot">Recurring and upcoming charges</div></div><div className="panel metric"><Clock3 size={17} className="metric-icon" /><div className="metric-label">Upcoming</div><div className="metric-value">{query.data?.filter((bill) => bill.status === 'upcoming').length ?? '—'}</div><div className="metric-foot">Due in the coming cycle</div></div><div className="panel metric"><AlertCircle size={17} className="metric-icon" /><div className="metric-label">Overdue</div><div className="metric-value">{query.data?.filter((bill) => bill.status === 'overdue').length ?? '—'}</div><div className="metric-foot">Needs follow-up</div></div><div className="panel metric"><Wallet size={17} className="metric-icon" /><div className="metric-label">Upcoming total</div><div className="metric-value" style={{ fontSize: 21 }}>{money(query.data?.filter((bill) => bill.status !== 'paid').reduce((total, bill) => total + bill.amount, 0))}</div><div className="metric-foot">Based on unpaid bills</div></div></div>
    <Panel title="Bill calendar" note="Recurring charges and their current status" action={<Select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ width: 140, padding: '7px 9px' }} data-testid="select-bill-status"><option value="all">All statuses</option><option value="upcoming">Upcoming</option><option value="overdue">Overdue</option><option value="paid">Paid</option></Select>}>
      {query.isLoading ? <Loading /> : query.isError ? <LoadError retry={() => query.refetch()} /> : rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Bill</th><th>Home</th><th>Due date</th><th>Recurrence</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((bill) => <tr key={bill.id} data-testid={`row-bill-${bill.id}`}><td><div className="data-title">{bill.name}</div><div className="data-small">{bill.vendor}</div></td><td>{bill.homeName}</td><td className="mono">{dateLabel(bill.dueDate)}</td><td>{cap(bill.frequency)}</td><td className="mono">{money(bill.amount)}</td><td><Status value={bill.status} /></td><td>{bill.status !== 'paid' ? <Button className="btn-sm" variant="btn-primary" onClick={() => changeStatus(bill, 'paid')} disabled={update.isPending} testId={`button-mark-paid-${bill.id}`}><Check size={12} /> Mark paid</Button> : <Button className="btn-sm" onClick={() => changeStatus(bill, 'upcoming')} disabled={update.isPending} testId={`button-reopen-bill-${bill.id}`}>Reopen</Button>}</td></tr>)}</tbody></table></div> : <Empty title="No bills to track" copy="Add a recurring charge or home bill so the team can see what is due next." />}</Panel>
    {open && <Modal title="Add a bill" description="Track the vendor, amount, due date and repeat cycle." onClose={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Home"><Select name="homeId" required defaultValue={session?.homeId || ''}><option value="" disabled>Select a home</option>{(homes.data || []).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></Field><Field label="Bill name"><TextInput name="name" required placeholder="Electricity" /></Field><Field label="Vendor"><TextInput name="vendor" required placeholder="Provider or landlord" /></Field><Field label="Amount (KES)"><TextInput name="amount" type="number" min="1" required placeholder="8,250" /></Field><Field label="Due date"><TextInput name="dueDate" type="date" required /></Field><Field label="Recurrence"><Select name="frequency" defaultValue="monthly"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></Select></Field></div><div className="modal-foot"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add bill'} <Receipt size={14} /></Button></div></form></Modal>}
  </>;
}

const ATTACHMENT_MARK = '\n\n--- PRIVATE FILE REFERENCES ---\n';
function visibleIssueDescription(description: string) {
  return description.split(ATTACHMENT_MARK)[0];
}
function issueFileReferences(description: string): { name: string; path: string }[] {
  const section = description.split(ATTACHMENT_MARK)[1];
  if (!section) return [];
  return section.split('\n').filter(Boolean).map((line) => {
    const [name, path] = line.split('|');
    return { name, path };
  }).filter((item) => !!item.path);
}
function allIssueFiles(issue: Issue) {
  return [...(issue.attachments || []).map((attachment) => ({ name: attachment.name, path: attachment.objectPath })), ...issueFileReferences(issue.description)];
}

function IssuesPage({ session }: { session: any }) {
  const query = useListIssues();
  const homes = useListHomes();
  const create = useCreateIssue();
  const update = useUpdateIssue();
  const comment = useAddIssueComment();
  const requestUpload = useRequestUploadUrl();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const rows = useMemo(() => (query.data || []).filter((issue) => filter === 'all' || issue.status === filter), [query.data, filter]);
  const invalidate = () => { cache.invalidateQueries({ queryKey: getListIssuesQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    setBusy(true);
    try {
      const files = Array.from((formElement.elements.namedItem('attachments') as HTMLInputElement)?.files || []);
      const attachments: IssueAttachment[] = [];
      for (const file of files) {
        const contentType = file.type || 'application/octet-stream';
        const signed = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType } });
        const uploaded = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
        if (!uploaded.ok) throw new Error('Attachment upload failed');
        attachments.push({ name: file.name, objectPath: signed.objectPath, contentType, size: file.size });
      }
      const data: IssueInput = { homeId: String(form.get('homeId')), title: String(form.get('title')), description: String(form.get('description')), priority: String(form.get('priority')) as IssueInput['priority'], deadline: String(form.get('deadline') || '') || null, attachments };
      create.mutate({ data }, { onSuccess: () => { invalidate(); setOpen(false); notify('Issue logged for follow-through'); }, onError: () => notify('Could not save this issue. Please try again.') });
    } catch {
      notify('A private attachment could not be uploaded. The issue was not submitted.');
    } finally { setBusy(false); }
  };
  const setStatus = (issue: Issue, status: 'open' | 'in_progress' | 'resolved') => update.mutate({ id: issue.id, data: { status } }, { onSuccess: () => { invalidate(); notify(`Issue marked ${cap(status).toLowerCase()}`); }, onError: () => notify('Could not update issue status.') });
  const addComment = (issue: Issue) => {
    const message = (commentDrafts[issue.id] || '').trim();
    if (!message) return;
    comment.mutate({ id: issue.id, data: { message } }, { onSuccess: () => { invalidate(); setCommentDrafts((prev) => ({ ...prev, [issue.id]: '' })); notify('Follow-up added'); }, onError: () => notify('Could not add this follow-up.') });
  };
  return <>{toast}<PageHead kicker="Follow-up for every home" title="Issues" subtitle="Log what needs attention, set a priority and keep the next step visible." action={<Button variant="btn-primary" onClick={() => setOpen(true)} testId="button-log-issue"><Plus size={15} /> Log an issue</Button>} />
    <div className="metric-grid"><div className="panel metric"><AlertCircle size={17} className="metric-icon" /><div className="metric-label">Open</div><div className="metric-value">{query.data?.filter((issue) => issue.status === 'open').length ?? '—'}</div><div className="metric-foot">Needs an owner or next step</div></div><div className="panel metric"><ActivityIcon size={17} className="metric-icon" /><div className="metric-label">In progress</div><div className="metric-value">{query.data?.filter((issue) => issue.status === 'in_progress').length ?? '—'}</div><div className="metric-foot">Being followed through</div></div><div className="panel metric"><CheckCircle2 size={17} className="metric-icon" /><div className="metric-label">Resolved</div><div className="metric-value">{query.data?.filter((issue) => issue.status === 'resolved').length ?? '—'}</div><div className="metric-foot">Closed with a clear outcome</div></div><div className="panel metric"><ShieldCheck size={17} className="metric-icon" /><div className="metric-label">Urgent / high</div><div className="metric-value">{query.data?.filter((issue) => ['urgent', 'high'].includes(issue.priority) && issue.status !== 'resolved').length ?? '—'}</div><div className="metric-foot">Prioritize with your team</div></div></div>
    <Panel title="Issue log" note="Visible across your accessible homes" action={<Select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ width: 145, padding: '7px 9px' }} data-testid="select-issue-status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="all">All issues</option></Select>}>
      {query.isLoading ? <Loading /> : query.isError ? <LoadError retry={() => query.refetch()} /> : rows.length ? <div style={{ padding: '4px 19px 15px' }}>{rows.map((issue) => <article key={issue.id} className="activity-row" style={{ display: 'block', padding: '17px 0' }} data-testid={`card-issue-${issue.id}`}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><div><div className="data-title" style={{ fontSize: 13 }}>{issue.title}</div><div className="data-small">{issue.homeName} · reported by {issue.createdBy} · {dateLabel(issue.createdAt)}</div></div><div className="filter-row"><Status value={issue.priority} /><Status value={issue.status} /></div></div><p style={{ color: '#64746a', fontSize: 12, lineHeight: 1.55, margin: '12px 0' }}>{visibleIssueDescription(issue.description)}</p>{issue.deadline && <div className="data-small" style={{ marginBottom: 9 }}>Target date: {dateLabel(issue.deadline)}</div>}{allIssueFiles(issue).map((file) => <a key={file.path} href={`/api/storage${file.path}`} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginRight: 7, marginBottom: 9 }} data-testid={`link-issue-attachment-${issue.id}`}><Paperclip size={12} />{file.name}</a>)}{issue.comments?.length > 0 && <div style={{ background: '#f1f1e7', borderRadius: 9, padding: '10px 12px', marginBottom: 10 }}>{issue.comments.slice(-2).map((item) => <div key={item.id} style={{ fontSize: 11, color: '#617367', marginBottom: 5 }}><strong>{item.author}</strong> · {item.message}</div>)}</div>}<div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}><TextInput value={commentDrafts[issue.id] || ''} onChange={(event) => setCommentDrafts((prev) => ({ ...prev, [issue.id]: event.target.value }))} placeholder="Add a follow-up note" style={{ maxWidth: 260, padding: '7px 9px' }} data-testid={`input-comment-${issue.id}`} /><Button className="btn-sm" onClick={() => addComment(issue)} disabled={comment.isPending} testId={`button-comment-${issue.id}`}><MessageSquare size={12} /> Add note</Button><span style={{ flex: 1 }} />{issue.status !== 'resolved' && <Button className="btn-sm" onClick={() => setStatus(issue, issue.status === 'open' ? 'in_progress' : 'resolved')} disabled={update.isPending} testId={`button-advance-issue-${issue.id}`}>{issue.status === 'open' ? 'Start follow-up' : 'Resolve'} <ArrowRight size={12} /></Button>}{issue.status === 'resolved' && <Button className="btn-sm" onClick={() => setStatus(issue, 'open')} disabled={update.isPending} testId={`button-reopen-issue-${issue.id}`}>Reopen</Button>}</div></article>)}</div> : <Empty title="No issues in this view" copy="A clear issue log helps the next person pick up the right follow-through." />}</Panel>
     {open && <Modal title="Log an issue" description="Describe what needs attention and who needs to know." onClose={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Home"><Select name="homeId" required defaultValue={session?.homeId || ''}><option value="" disabled>Select a home</option>{(homes.data || []).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></Field><Field label="Priority"><Select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field><Field label="Short title" full><TextInput name="title" required placeholder="What needs attention?" /></Field><Field label="Description" full><TextArea name="description" required placeholder="Add useful context and what has already been tried." /></Field><Field label="Target date"><TextInput name="deadline" type="date" /></Field><Field label="Operational attachment"><TextInput name="attachments" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" /></Field></div><div role="note" style={{ marginTop: 11, padding: '10px 12px', borderRadius: 8, background: '#f7f0e6', color: '#735838', fontSize: 11, lineHeight: 1.5 }}><strong>Privacy reminder:</strong> Do not add children’s names, images, health or safeguarding details here. Use your approved case records for sensitive information.</div><div className="data-small" style={{ marginTop: 8 }}>Files upload directly to private storage and are visible only to authorized users for that home.</div><div className="modal-foot"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={busy || create.isPending || requestUpload.isPending}>{busy ? 'Saving securely…' : 'Log issue'} <Send size={14} /></Button></div></form></Modal>}
  </>;
}

function ReportsPage({ session }: { session: any }) {
  const query = useListReports();
  const homes = useListHomes();
  const submitReport = useSubmitWeeklyReport();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [open, setOpen] = useState(false);
  const formSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const data: WeeklyReportInput = { homeId: String(form.get('homeId')), weekStarting: String(form.get('weekStarting')), summary: String(form.get('summary')), highlights: String(form.get('highlights') || ''), needsSupport: String(form.get('needsSupport') || '') };
    submitReport.mutate({ data }, { onSuccess: () => { cache.invalidateQueries({ queryKey: getListReportsQueryKey() }); cache.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); cache.invalidateQueries({ queryKey: getListHomesQueryKey() }); setOpen(false); notify('Weekly report submitted'); }, onError: () => notify('Could not submit the report. Please try again.') });
  };
  return <>{toast}<PageHead kicker="A rhythm of reflection" title="Weekly reports" subtitle="Share what went well, what changed and where your home needs support." action={<Button variant="btn-primary" onClick={() => setOpen(true)} testId="button-submit-report"><Plus size={15} /> Submit weekly report</Button>} />
    <div className="metric-grid"><div className="panel metric"><FileText size={17} className="metric-icon" /><div className="metric-label">Reports available</div><div className="metric-value">{query.data?.length ?? '—'}</div><div className="metric-foot">Submitted weekly snapshots</div></div><div className="panel metric"><Building2 size={17} className="metric-icon" /><div className="metric-label">Homes in view</div><div className="metric-value">{homes.data?.length ?? '—'}</div><div className="metric-foot">Reporting across your homes</div></div><div className="panel metric"><CalendarDays size={17} className="metric-icon" /><div className="metric-label">Current week</div><div className="metric-value" style={{ fontSize: 18 }}>{dateLabel(new Date().toISOString())}</div><div className="metric-foot">A fresh check-in for the team</div></div><div className="panel metric"><ClipboardCheck size={17} className="metric-icon" /><div className="metric-label">Reporting compliance</div><div className="metric-value" style={{ fontSize: 21 }}>Dashboard</div><div className="metric-foot">See current coverage on Today</div></div></div>
    <Panel title="Recent home reports" note="The latest notes shared by managers">
      {query.isLoading ? <Loading /> : query.isError ? <LoadError retry={() => query.refetch()} /> : query.data?.length ? <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 12 }}>{query.data.map((report: WeeklyReport) => <ReportCard report={report} key={report.id} />)}</div> : <Empty title="No weekly reports yet" copy="A short, useful weekly note helps leadership spot what is working and where a home needs support." action={<Button variant="btn-primary" onClick={() => setOpen(true)}><Plus size={14} /> Write the first report</Button>} />}
    </Panel>
    {open && <Modal title="Submit a weekly report" description="A clear, honest snapshot helps the rest of the team respond well." onClose={() => setOpen(false)}><form onSubmit={formSubmit}><div className="form-grid"><Field label="Home"><Select name="homeId" required defaultValue={session?.homeId || ''}><option value="" disabled>Select a home</option>{(homes.data || []).map((home) => <option key={home.id} value={home.id}>{home.name}</option>)}</Select></Field><Field label="Week starting"><TextInput name="weekStarting" type="date" required defaultValue={new Date(Date.now() - ((new Date().getDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)} /></Field><Field label="How was the week?" full><TextArea name="summary" required placeholder="The overall picture: how the home and children are doing." /></Field><Field label="Highlights" full><TextArea name="highlights" placeholder="Progress, milestones or moments worth sharing." /></Field><Field label="Where would support help?" full><TextArea name="needsSupport" placeholder="Any practical support, decision or follow-up needed." /></Field></div><div className="modal-foot"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={submitReport.isPending}>{submitReport.isPending ? 'Submitting…' : 'Submit report'} <Send size={14} /></Button></div></form></Modal>}
  </>;
}
function ReportCard({ report }: { report: WeeklyReport }) {
  return <article className="panel report-card" data-testid={`card-report-${report.id}`}><div className="report-top"><div><div className="data-title">{report.homeName}</div><div className="data-small">Submitted by {report.submittedBy}</div></div><div className="report-date">WEEK OF<br />{dateLabel(report.weekStarting)}</div></div><div className="report-block"><strong>Weekly picture</strong><p>{report.summary}</p></div>{report.highlights && <div className="report-block"><strong>Highlights</strong><p>{report.highlights}</p></div>}{report.needsSupport && <div className="report-block"><strong>Support requested</strong><p>{report.needsSupport}</p></div>}<div className="data-small" style={{ marginTop: 15 }}>Submitted {dateLabel(report.submittedAt)}</div></article>;
}

function SettingsPage({ session }: { session: any }) {
  const settings = useGetSettings();
  const members = useListMembers();
  const homes = useListHomes();
  const updateSettings = useUpdateSettings();
  const assign = useAssignMember();
  const cache = useQueryClient();
  const { notify, toast } = useNotice();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState('');
  useEffect(() => {
    if (settings.data) setThresholdDraft(String(settings.data.approvalThreshold));
  }, [settings.data?.approvalThreshold]);
  const isCEO = session?.role === 'ceo';
  const saveThreshold = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data: OrganizationSettingsUpdate = { approvalThreshold: Number(thresholdDraft) };
    updateSettings.mutate({ data }, { onSuccess: () => { cache.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); cache.invalidateQueries({ queryKey: getGetSessionQueryKey() }); notify('Approval threshold saved'); }, onError: () => notify('Could not save the approval threshold.') });
  };
  const assignMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const role = String(form.get('role')) as MemberInput['role'];
    const data: MemberInput = { email: String(form.get('email')), role, homeId: role === 'manager' ? String(form.get('homeId')) : null };
    assign.mutate({ data }, { onSuccess: () => { cache.invalidateQueries({ queryKey: getListMembersQueryKey() }); cache.invalidateQueries({ queryKey: getListHomesQueryKey() }); setInviteOpen(false); notify('Team access updated'); }, onError: () => notify('Could not assign this account. Confirm the email and try again.') });
  };
  return <>{toast}<PageHead kicker="A workspace that fits your team" title="Settings" subtitle="Keep access and spending approvals aligned with how your organization works." />
    <div className="dashboard-grid">
      <div className="stack">
        <Panel title="Expense approval threshold" note="Expenses above this amount require CEO review">
          {settings.isLoading ? <div className="loading-bars"><div className="skeleton" /><div className="skeleton large" /></div> : settings.isError ? <div style={{ padding: 20 }}><LoadError retry={() => settings.refetch()} /></div> : <form onSubmit={saveThreshold} style={{ padding: 20 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="mono">KES</span><TextInput type="number" min="0" value={thresholdDraft} onChange={(event) => setThresholdDraft(event.target.value)} disabled={!isCEO} required style={{ maxWidth: 200 }} data-testid="input-approval-threshold" /><span className="table-muted">per expense</span></div><p className="table-muted" style={{ lineHeight: 1.55, maxWidth: 440, margin: '13px 0 17px' }}>Managers can submit expenses as they happen. Items above this amount pause for a CEO decision so larger costs have shared context.</p>{isCEO ? <Button type="submit" variant="btn-primary" disabled={updateSettings.isPending || !thresholdDraft}>{updateSettings.isPending ? 'Saving…' : 'Save threshold'} <Check size={14} /></Button> : <div className="status-pill">Read-only for your role</div>}</form>}
        </Panel>
        <Panel title="Team access" note="Roles and home assignments" action={isCEO ? <Button className="btn-sm" variant="btn-primary" onClick={() => setInviteOpen(true)} testId="button-assign-member"><Plus size={13} /> Assign a member</Button> : null}>
          {members.isLoading ? <Loading rows={2} /> : members.isError ? <div style={{ padding: 18 }}><LoadError retry={() => members.refetch()} /></div> : members.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Home</th></tr></thead><tbody>{members.data.map((member) => <tr key={member.id} data-testid={`row-member-${member.id}`}><td><div className="data-title">{member.email}</div></td><td><Status value={member.role} /></td><td>{member.homeName || (member.role === 'ceo' ? 'Organization-wide' : 'Not assigned')}</td></tr>)}</tbody></table></div> : <Empty title="No team members listed" copy="Member access is managed here so each manager sees the right home." />}
        </Panel>
      </div>
      <div className="stack">
        <section className="panel" style={{ background: '#e7eadc', padding: 21 }}><div className="page-kicker">Access in practice</div><h2 className="panel-title" style={{ fontSize: 17 }}>Right information, right people.</h2><p style={{ fontSize: 12, lineHeight: 1.65, color: '#63756a' }}>Home managers work within their assigned home. CEOs have an organization-wide view to coordinate budgets, approvals, reporting and follow-through.</p><div className="activity-row"><ShieldCheck size={17} color="#55745f" /><span style={{ fontSize: 11, color: '#4e6558' }}>Account assignment happens here after sign-up.</span></div></section>
        <Panel title="Your operating context" note="How Wema has you connected"><div className="activity-list"><DetailLine label="Signed in as" value={session?.email || '—'} /><DetailLine label="Role" value={cap(session?.role)} /><DetailLine label="Assigned home" value={session?.homeName || 'Organization-wide'} /><DetailLine label="Approval threshold" value={money(session?.threshold)} /></div></Panel>
      </div>
    </div>
    {inviteOpen && <Modal title="Assign a team member" description="Enter the account email they use to sign in, then choose their role." onClose={() => setInviteOpen(false)}><form onSubmit={assignMember}><div className="form-grid"><Field label="Account email" full><TextInput name="email" type="email" required placeholder="manager@example.org" /></Field><Field label="Role"><Select name="role" defaultValue="manager"><option value="manager">Home manager</option><option value="ceo">CEO</option></Select></Field><Field label="Home assignment"><Select name="homeId" defaultValue=""><option value="">Select a home</option>{(homes.data || []).map((home) => <option value={home.id} key={home.id}>{home.name}</option>)}</Select></Field></div><div className="data-small" style={{ marginTop: 10 }}>For a CEO, home assignment is ignored. For a manager, choose their home before saving.</div><div className="modal-foot"><Button onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="submit" variant="btn-primary" disabled={assign.isPending}>{assign.isPending ? 'Saving…' : 'Assign access'} <Users size={14} /></Button></div></form></Modal>}
  </>;
}

function RouteError({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function AppRoutes() {
  return <IdentityCacheBoundary><RouteError><Switch>
    <Route path="/" component={PublicLanding} />
    <Route path="/sign-in/*?" component={() => <AuthScreen mode="sign-in" />} />
    <Route path="/sign-up/*?" component={() => <AuthScreen mode="sign-up" />} />
    <Route path="/dashboard" component={() => <SignedInGate title="Today">{(session) => <DashboardPage session={session} />}</SignedInGate>} />
    <Route path="/homes" component={() => <SignedInGate title="Homes">{(session) => <HomesPage session={session} />}</SignedInGate>} />
    <Route path="/homes/:id" component={() => <SignedInGate title="Home profile">{(session) => <HomeDetailPage session={session} />}</SignedInGate>} />
    <Route path="/expenses" component={() => <SignedInGate title="Expenses">{(session) => <ExpensesPage session={session} />}</SignedInGate>} />
    <Route path="/inventory" component={() => <SignedInGate title="Inventory">{(session) => <InventoryPage session={session} />}</SignedInGate>} />
    <Route path="/bills" component={() => <SignedInGate title="Bills">{(session) => <BillsPage session={session} />}</SignedInGate>} />
    <Route path="/issues" component={() => <SignedInGate title="Issues">{(session) => <IssuesPage session={session} />}</SignedInGate>} />
    <Route path="/reports" component={() => <SignedInGate title="Weekly reports">{(session) => <ReportsPage session={session} />}</SignedInGate>} />
    <Route path="/settings" component={() => <SignedInGate title="Settings">{(session) => <SettingsPage session={session} />}</SignedInGate>} />
    <Route component={() => <main className="min-h-[100dvh] grid place-items-center p-6"><div className="panel" style={{ maxWidth: 480, padding: 28, textAlign: 'center' }}><div className="empty-icon"><MapPin size={22} /></div><h1 className="page-title" style={{ fontSize: 25 }}>This page isn’t on the map.</h1><p className="page-subtitle" style={{ marginBottom: 18 }}>The workspace only includes the tools your home team needs.</p><Link href="/dashboard" className="btn btn-primary">Back to today <ArrowRight size={14} /></Link></div></main>} />
  </Switch></RouteError></IdentityCacheBoundary>;
}

function App() {
  const publishableKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  return <ClerkProvider publishableKey={publishableKey} proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL} appearance={{ variables: { colorPrimary: '#2b594c', colorForeground: '#29483e', colorBackground: '#fbf9f2', borderRadius: '10px', fontFamily: 'DM Sans, sans-serif' } }} localization={{ signIn: { start: { title: 'Welcome back to Wema', subtitle: 'Sign in to your home operations workspace.' } }, signUp: { start: { title: 'Join your care team', subtitle: 'Create an account to get started.' } } } as any}>
    <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={BASE}><AppRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>
  </ClerkProvider>;
}

export default App;
