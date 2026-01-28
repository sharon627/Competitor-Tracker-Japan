import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  LayoutDashboard, 
  History, 
  RefreshCcw, 
  Search, 
  X,
  FileText,
  Activity,
  Loader2,
  Flag,
  Hotel,
  Plus,
  Calendar,
  ExternalLink,
  Clock,
  Star,
  Circle,
  Heart,
  Database,
  Image as ImageIcon,
  Zap,
  Sparkles,
  Timer,
  MessageSquare,
  Send,
  Bot,
  User,
  Lightbulb
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

// --- Types ---
interface Campaign {
  id: number;
  name: string;
  info: string;
  url: string;
  category: string;
  discoveryDate: string;
  lastSeenDate: string;
  isActive: boolean;
  competitor: string; 
  isGrounded: boolean;
  reliabilityScore: number; 
  isBanner?: boolean;
}

interface ScrapeLog {
  id: number;
  date: string;
  status: 'success' | 'failed' | 'partial' | 'proxy-retry';
  found: number;
  brand: string;
  error?: string;
  proxyUsed?: string;
}

interface Message {
  id: number;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

// --- Brand Specific Isolation ---
const BRAND_CONFIGS: Record<string, {
  name: string;
  url: string;
  color: string;
  getPrompt: (pageText: string, url: string) => string;
}> = {
  marriott: {
    name: 'Marriott',
    url: "https://www.marriott.com/ja/offers.mi",
    color: 'blue',
    getPrompt: (pageText, url) => `GCM INTEL EXTRACTION: Marriott Japan Offers
      URL: ${url}
      STREAM: ${pageText}
      TASK: Identify and extract all current marketing campaigns and HIGH-IMPACT HERO BANNERS.
      PRIORITY TARGETS: Look for seasonal Japan themes, Member Exclusives, and Flagship promotions.
      IMPORTANT: If it's a primary visual slide/hero banner, set "isBanner": true.
      IMPORTANT: TRANSLATE ALL EXTRACTED TEXT (name, info, category) INTO ENGLISH.
      Respond ONLY with a JSON array: [{"name": "...", "info": "...", "category": "...", "isBanner": boolean}]`
  },
  ihg: {
    name: 'IHG',
    url: "https://www.ihg.com/content/jp/ja/offers",
    color: 'teal',
    getPrompt: (pageText, url) => `GCM INTEL EXTRACTION: IHG Japan Offers
      URL: ${url}
      STREAM: ${pageText}
      TASK: Deep scan for high-impact Visual Hero Banners and Promotional Seasonal Campaigns in Japan.
      IMPORTANT: If it's a primary visual slide/hero banner, set "isBanner": true.
      IMPORTANT: TRANSLATE ALL EXTRACTED TEXT (name, info, category) INTO ENGLISH.
      Respond ONLY with a JSON array: [{"name": "...", "info": "...", "category": "...", "isBanner": boolean}]`
  },
  hyatt: {
    name: 'Hyatt',
    url: "https://www.hyatt.com/loyalty/ja-JP",
    color: 'indigo',
    getPrompt: (pageText, url) => `GCM INTEL EXTRACTION: Hyatt Japan Loyalty
      URL: ${url}
      STREAM: ${pageText}
      TASK: Extract active promotional offers and limited time member deals for Japan.
      SPECIFIC PRIORITY: Identify high-impact Hero Banners like "TO A NEW ADVENTURE" and point-earning promotions (e.g., 5 Base Points, free nights from 3,500 points).
      IMPORTANT: If it's a primary visual/hero banner or main promotion, set "isBanner": true.
      IMPORTANT: TRANSLATE ALL EXTRACTED TEXT (name, info, category) INTO ENGLISH.
      Respond ONLY with a JSON array: [{"name": "...", "info": "...", "category": "...", "isBanner": boolean}]`
  },
  accor: {
    name: 'Accor',
    url: "https://all.accor.com/a/ja/deals-corner.html",
    color: 'amber',
    getPrompt: (pageText, url) => `GCM INTEL EXTRACTION: Accor ALL Japan Deals Corner
      URL: ${url}
      STREAM: ${pageText}
      TASK: Identify tactical promotions, seasonal offers, and ALL member exclusives in the Japan market.
      IMPORTANT: If it's a primary visual/hero banner, set "isBanner": true.
      IMPORTANT: TRANSLATE ALL EXTRACTED TEXT (name, info, category) INTO ENGLISH.
      Respond ONLY with a JSON array: [{"name": "...", "info": "...", "category": "...", "isBanner": boolean}]`
  },
  hilton: {
    name: 'Hilton',
    url: "https://www.hilton.com/ja/",
    color: 'emerald',
    getPrompt: (pageText, url) => `GCM INTEL EXTRACTION: Hilton Japan Regional
      URL: ${url}
      STREAM: ${pageText}
      TASK: Extract active promotional assets and marketing messaging for Hilton's Japan presence.
      SPECIFIC TARGETS: Look for "Points Unlimited", Hilton Honors member deals, and seasonal Japan vacation offers.
      IMPORTANT: If it's a primary visual slide/hero banner, set "isBanner": true.
      IMPORTANT: TRANSLATE ALL EXTRACTED TEXT (name, info, category) INTO ENGLISH.
      Respond ONLY with a JSON array: [{"name": "...", "info": "...", "category": "...", "isBanner": boolean}]`
  }
};

const STORAGE_KEYS = {
  DATA: 'gcm_intel_v26',
  LOGS: 'gcm_logs_v26',
  META: 'gcm_meta_v26',
  FAVORITES: 'gcm_favorites_v26'
};

const PROXIES = [
  { name: 'AllOrigins', url: "https://api.allorigins.win/get?url=" },
  { name: 'CorsProxyIO', url: "https://corsproxy.io/?" },
  { name: 'CodeTabs', url: "https://api.codetabs.com/v1/proxy?quest=" }
];

const categoryLabels: Record<string, string> = {
  family: 'Family & Kids',
  dining: 'Dining & Food',
  rewards: 'Member Rewards',
  business: 'Business Travel',
  travel: 'Leisure & Travel',
  spa: 'Spa & Wellness',
  wedding: 'Weddings & Events',
  general: 'General Promo',
  partnership: 'Partnership',
  seasonal: 'Seasonal Deals'
};

const getBrandColor = (brand: string) => {
  const brandKey = brand.toLowerCase();
  if (brandKey === 'ota') return 'bg-orange-600';
  
  // Find match in config names
  const config = Object.values(BRAND_CONFIGS).find(c => c.name.toLowerCase() === brandKey);
  if (config) return `bg-${config.color}-600`;
  
  return 'bg-slate-400';
};

const getBrandBadgeStyle = (brand: string) => {
  const brandKey = brand.toLowerCase();
  if (brandKey === 'ota') {
    return 'bg-orange-50 text-orange-600 border-orange-100/50';
  }
  
  const config = Object.values(BRAND_CONFIGS).find(c => c.name.toLowerCase() === brandKey);
  if (config) {
    const color = config.color;
    return `bg-${color}-50 text-${color}-600 border-${color}-100/50`;
  }
  
  return 'bg-slate-50 text-slate-600 border-slate-100';
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const App = () => {
  const [activeTab, setActiveTab] = useState<'marriott' | 'logs' | 'chat'>('marriott');
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.DATA);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [logs, setLogs] = useState<ScrapeLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LOGS);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [lastSync, setLastSync] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.META));
  const [favorites, setFavorites] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [currentBrandSync, setCurrentBrandSync] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'ai', text: 'Hello! I am your Market Intelligence Assistant. How can I help you refine your marketing strategy for the Japan region today?', timestamp: new Date() }
  ]);
  
  const cooldownRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(campaigns));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
    if (lastSync) localStorage.setItem(STORAGE_KEYS.META, lastSync);
  }, [campaigns, logs, lastSync, favorites]);

  useEffect(() => {
    if (cooldown > 0) {
      cooldownRef.current = setInterval(() => setCooldown(prev => prev - 1), 1000);
    } else if (cooldownRef.current) {
      clearInterval(cooldownRef.current);
    }
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, [cooldown]);

  const toggleFavorite = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFavorites(prev => 
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  const cleanHTML = (html: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const metaBuffer: string[] = [];
    
    // Capture enhanced metadata and ARIA labels often used in modern sliders
    doc.querySelectorAll('[data-title], [data-description], [aria-label], [aria-roledescription], .hero, .banner, .carousel, [data-testid*="promo"]').forEach(el => {
      const title = el.getAttribute('data-title') || el.getAttribute('title');
      const desc = el.getAttribute('data-description');
      const label = el.getAttribute('aria-label') || el.getAttribute('aria-roledescription');
      
      if (title) metaBuffer.push(` [BANNER_TITLE: ${title}] `);
      if (desc) metaBuffer.push(` [BANNER_DESC: ${desc}] `);
      if (label) metaBuffer.push(` [UI_LABEL: ${label}] `);
      
      el.querySelectorAll('img').forEach(img => {
        if (img.alt) metaBuffer.push(` [IMG_ALT: ${img.alt}] `);
      });
    });

    const toRemove = doc.querySelectorAll('script, style, iframe, svg, path, link, meta, noscript, header, footer, nav');
    toRemove.forEach(el => el.remove());
    
    const bodyText = doc.body.innerText;
    // Increased substring for better context
    const finalStream = `${metaBuffer.join(' ')} ${bodyText}`.replace(/\s+/g, ' ').substring(0, 48000).trim();
    return finalStream;
  };

  const robustFetch = async (targetUrl: string): Promise<{ contents: string, proxy: string }> => {
    for (const proxy of PROXIES) {
      try {
        const fullUrl = proxy.name === 'AllOrigins' 
          ? `${proxy.url}${encodeURIComponent(targetUrl)}` 
          : `${proxy.url}${targetUrl}`;
        const res = await fetch(fullUrl, { mode: 'cors' });
        if (!res.ok) continue;
        if (proxy.name === 'AllOrigins') {
          const data = await res.json();
          if (data.contents) return { contents: data.contents, proxy: proxy.name };
        } else {
          const text = await res.text();
          if (text && text.length > 200) return { contents: text, proxy: proxy.name };
        }
      } catch (e) { continue; }
    }
    throw new Error("Proxy node failure.");
  };

  const runScraper = async () => {
    if (cooldown > 0 || isScraping) return;
    setIsScraping(true);
    
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        setIsScraping(false);
        return;
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
      for (const brandKey in BRAND_CONFIGS) {
        const config = BRAND_CONFIGS[brandKey];
        setCurrentBrandSync(config.name);
        
        try {
          const { contents, proxy } = await robustFetch(config.url);
          const pageText = cleanHTML(contents);
          const prompt = config.getPrompt(pageText, config.url);

          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.1 }
          });

          const extracted = JSON.parse(response.text || '[]');

          const processed: Campaign[] = extracted.map((item: any, i: number) => ({
            ...item,
            id: Date.now() + i + Math.random(),
            competitor: config.name,
            discoveryDate: new Date().toISOString(),
            lastSeenDate: new Date().toISOString(),
            isActive: true,
            isGrounded: true,
            reliabilityScore: 100,
            url: config.url
          }));

          setCampaigns(prev => {
            const existingNames = new Set(prev.map(c => `${c.competitor}-${c.name}`));
            const trulyNew = processed.filter(p => !existingNames.has(`${p.competitor}-${p.name}`));
            return [...trulyNew, ...prev].slice(0, 500);
          });

          setLogs(prev => [{
            id: Date.now(),
            date: new Date().toISOString(),
            status: 'success' as const,
            found: processed.length,
            brand: config.name,
            proxyUsed: proxy
          }, ...prev].slice(0, 100));
          
        } catch (err) {
          setLogs(prev => [{
            id: Date.now(),
            date: new Date().toISOString(),
            status: 'failed' as const,
            found: 0,
            brand: config.name,
            error: String(err)
          }, ...prev].slice(0, 100));
        }
      }
      setLastSync(new Date().toISOString());
      setIsScraping(false);
      setCurrentBrandSync(null);
    } catch (error) {
      setIsScraping(false);
      setCurrentBrandSync(null);
    }
  };

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           c.info.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || c.category === categoryFilter;
      const matchesBrand = brandFilter === 'all' || c.competitor.toLowerCase() === brandFilter.toLowerCase();
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? c.isActive : !c.isActive);
      const matchesFavorite = !showFavoritesOnly || favorites.includes(c.id);
      
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const now = new Date();
        const disc = new Date(c.discoveryDate);
        const diffHours = (now.getTime() - disc.getTime()) / (1000 * 60 * 60);
        
        if (dateFilter === 'today') matchesDate = diffHours <= 24;
        else if (dateFilter === 'week') matchesDate = diffHours <= 168;
        else if (dateFilter === 'month') matchesDate = diffHours <= 720;
      }

      return matchesSearch && matchesCategory && matchesBrand && matchesStatus && matchesFavorite && matchesDate;
    });
  }, [campaigns, searchTerm, categoryFilter, brandFilter, statusFilter, dateFilter, showFavoritesOnly, favorites]);

  const stats = useMemo(() => {
    const active = campaigns.filter(c => c.isActive).length;
    const now = new Date();
    const isNew = (date: string) => (now.getTime() - new Date(date).getTime()) < 7 * 24 * 60 * 60 * 1000;
    const newThisWeek = campaigns.filter(c => isNew(c.discoveryDate)).length;
    
    return {
      total: campaigns.length,
      active,
      inactive: campaigns.length - active,
      newThisWeek,
      favoritesCount: favorites.length
    };
  }, [campaigns, favorites]);

  // Unique brand names for the filter dropdown
  const uniqueBrands = useMemo(() => {
    const brands = Object.values(BRAND_CONFIGS).map(c => c.name);
    return Array.from(new Set(brands));
  }, []);

  return (
    <div className="flex min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Sidebar */}
      <aside className="w-64 bg-[#1e293b] flex flex-col fixed inset-y-0 z-50 text-white shadow-xl">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity size={20} className="text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-lg tracking-tight uppercase">Campaign</span>
              <span className="text-xs opacity-60">Tracker Japan</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {[
            { id: 'marriott', label: 'Market Intel', icon: Hotel },
            { id: 'chat', label: 'Strategy AI', icon: MessageSquare },
            { id: 'logs', label: 'History Logs', icon: History }
          ].map((tab) => (
            <button 
              key={tab.id} 
              onClick={() => setActiveTab(tab.id as any)} 
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button 
            onClick={() => runScraper()} 
            disabled={isScraping || cooldown > 0} 
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/40 ${isScraping ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 active:scale-95'}`}
          >
            {isScraping ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            {isScraping ? `Scraping ${currentBrandSync || ''}...` : 'Run Scraper'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 min-h-screen flex flex-col">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 px-10 flex items-center justify-between sticky top-0 z-40">
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight capitalize">
              {activeTab === 'marriott' ? 'Market Intelligence Feed' : activeTab === 'chat' ? 'Strategy AI Chat' : 'Operations History'}
            </h1>
            <p className="text-xs text-slate-500 font-medium">Monitoring competitor activity across Greater Japan</p>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input 
                type="text" 
                placeholder="Search signals..." 
                className="pl-10 pr-4 py-2.5 bg-slate-100 border-transparent rounded-lg text-sm w-80 focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all border border-slate-100 font-medium"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold">
              <Clock size={14} />
              <span>Updated: {lastSync ? new Date(lastSync).toLocaleTimeString() : '--:--:--'}</span>
            </div>
          </div>
        </header>

        {/* Dynamic Section Content */}
        <div className="p-10 space-y-10 animate-in">
          {activeTab === 'marriott' && (
            <div className="space-y-10">
              {/* Integrated Dashboard Overview */}
              <div className="flex items-stretch gap-8 overflow-visible">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-8">
                  <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                    <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
                      <Flag size={28} />
                    </div>
                    <div>
                      <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">{stats.total}</h3>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">Total Signals</p>
                    </div>
                  </div>
                  <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                    <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
                      <Heart size={28} className="fill-rose-600" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">{stats.favoritesCount}</h3>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">Saved Assets</p>
                    </div>
                  </div>
                  <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                      <Star size={28} />
                    </div>
                    <div>
                      <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">{stats.newThisWeek}</h3>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">New This Week</p>
                    </div>
                  </div>
                  <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-600">
                      <Database size={28} />
                    </div>
                    <div>
                      <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">{stats.inactive}</h3>
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">Archived</p>
                    </div>
                  </div>
                </div>
                
                {/* Independent Strategy AI Launch Button */}
                <button 
                  onClick={() => setActiveTab('chat')}
                  className="px-10 min-w-[220px] rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl shadow-blue-500/30 hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all group relative overflow-hidden"
                  title="Launch Strategy AI Brain"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-blue-600 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative z-10 flex flex-col items-center gap-1">
                    <Sparkles size={28} className="group-hover:rotate-12 transition-transform duration-500" />
                    <span className="text-[11px] font-black uppercase tracking-wider">Strategy AI</span>
                  </div>
                </button>
              </div>

              {/* Filter Bar */}
              <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-end gap-6">
                <div className="flex flex-col gap-2.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest ml-1">Hotel Company</label>
                  <select 
                    className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-sm w-44 font-semibold outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 cursor-pointer transition-all"
                    value={brandFilter}
                    onChange={(e) => setBrandFilter(e.target.value)}
                  >
                    <option value="all">All Hotel Companies</option>
                    <option value="OTA">OTA</option>
                    {uniqueBrands.map(brandName => (
                      <option key={brandName} value={brandName}>{brandName}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest ml-1">Category</label>
                  <select 
                    className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-sm w-44 font-semibold outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 cursor-pointer transition-all"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest ml-1">Discovery Window</label>
                  <div className="relative">
                    <Timer size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <select 
                      className="bg-white border border-slate-200 rounded-xl pl-10 pr-5 py-3 text-sm w-44 font-semibold outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 cursor-pointer transition-all appearance-none"
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                    >
                      <option value="all">All Time</option>
                      <option value="today">Last 24 Hours</option>
                      <option value="week">Past 7 Days</option>
                      <option value="month">Past 30 Days</option>
                    </select>
                  </div>
                </div>
                
                <div className="flex flex-col gap-2.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest ml-1">Status</label>
                  <select 
                    className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-sm w-40 font-semibold outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 cursor-pointer transition-all"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active Only</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest ml-1">Favorites</label>
                  <button 
                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                    className={`px-5 py-3 rounded-xl text-sm font-bold border transition-all flex items-center gap-2 ${showFavoritesOnly ? 'bg-rose-50 border-rose-200 text-rose-600 ring-4 ring-rose-500/10' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  >
                    <Heart size={16} className={showFavoritesOnly ? "fill-rose-600" : ""} />
                    {showFavoritesOnly ? 'Showing Saved' : 'All Signals'}
                  </button>
                </div>

                <button 
                  onClick={() => { setCategoryFilter('all'); setStatusFilter('all'); setBrandFilter('all'); setDateFilter('all'); setSearchTerm(''); setShowFavoritesOnly(false); }}
                  className="px-6 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-all flex items-center gap-2 mb-0.5 active:scale-95"
                >
                  <X size={16} />
                  Clear Filters
                </button>
              </div>

              {/* Grid System */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {filteredCampaigns.map(c => (
                  <div 
                    key={c.id} 
                    onClick={() => setSelectedCampaign(c)}
                    className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-blue-900/5 transition-all cursor-pointer relative overflow-hidden flex flex-col h-full border-t-0"
                  >
                    <div className={`h-1.5 ${getBrandColor(c.competitor)}`} />
                    
                    <button 
                      onClick={(e) => toggleFavorite(c.id, e)}
                      className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-90"
                    >
                      <Heart 
                        size={18} 
                        className={favorites.includes(c.id) ? "fill-rose-500 text-rose-500" : "text-slate-400"} 
                      />
                    </button>
                    
                    {favorites.includes(c.id) && !isScraping && (
                      <div className="absolute top-4 right-4 z-0 opacity-100 group-hover:opacity-0 transition-opacity">
                         <Heart size={18} className="fill-rose-500 text-rose-500" />
                      </div>
                    )}

                    <div className="p-7 flex-1 flex flex-col space-y-5">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1 tracking-tight pr-6">
                          {c.name}
                        </h3>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                           <Circle size={8} className={`${c.isActive ? 'fill-emerald-400 text-emerald-400' : 'fill-slate-300 text-slate-300'} animate-pulse`} />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider border ${getBrandBadgeStyle(c.competitor)}`}>
                          {c.competitor}
                        </span>
                        <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold border border-slate-200">
                          {categoryLabels[c.category] || 'General'}
                        </span>
                        {c.isBanner && (
                          <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-[11px] font-extrabold border border-amber-100 flex items-center gap-1 shadow-sm">
                            <Zap size={10} className="fill-amber-600" /> FLAGSHIP HERO
                          </span>
                        )}
                        <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${c.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-100/50' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      
                      <p className="text-sm text-slate-500 leading-relaxed line-clamp-4 font-medium">
                        {c.info}
                      </p>
                    </div>

                    <div className="p-5 px-7 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between mt-auto group-hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-2 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                        <Calendar size={13} />
                        {formatDate(c.discoveryDate)}
                      </div>
                      <a 
                        href={c.url} 
                        target="_blank" 
                        onClick={(e) => e.stopPropagation()} 
                        className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-[11px] font-extrabold uppercase tracking-widest group/link"
                      >
                        <ExternalLink size={13} className="group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                        Source
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {filteredCampaigns.length === 0 && (
                <div className="py-32 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300">
                    <Search size={40} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">No signals found</h3>
                  <p className="text-slate-500 font-medium mt-2">Try adjusting your filters or keyword search</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="max-w-4xl mx-auto h-[calc(100vh-280px)] flex flex-col animate-in">
              {/* Chat Container */}
              <div className="flex-1 bg-white rounded-t-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                      <Bot size={20} />
                    </div>
                    <div>
                      h2 className="text-sm font-bold text-slate-800">Strategy Brain v1.0</h2>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Reasoning</span>
                      </div>
                    </div>
                  </div>
                  <button className="text-slate-400 hover:text-slate-600 transition-colors">
                    <Star size={18} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex gap-3 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
                          {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                        </div>
                        <div className={`p-4 rounded-2xl text-sm font-medium leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-700 border border-slate-100'}`}>
                          {msg.text}
                          <div className={`text-[10px] mt-2 opacity-60 ${msg.role === 'user' ? 'text-white' : 'text-slate-400'}`}>
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Suggestions */}
                <div className="p-4 bg-white border-t border-slate-50 flex items-center gap-3 overflow-x-auto no-scrollbar">
                  {[
                    "Compare Marriott vs Accor Japan strategy",
                    "Analyze Sakura season impact",
                    "Trend report for Japanese Dining",
                    "Competitor loyalty update summary"
                  ].map((suggestion, i) => (
                    <button 
                      key={i} 
                      className="whitespace-nowrap px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-xs font-bold text-slate-500 hover:bg-blue-50 hover:border-blue-100 hover:text-blue-600 transition-all flex items-center gap-2"
                    >
                      <Lightbulb size={12} />
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Area */}
              <div className="p-6 bg-white border border-slate-200 border-t-0 rounded-b-3xl shadow-lg shadow-slate-200/20">
                <div className="relative group">
                  <input 
                    type="text" 
                    placeholder="Ask about Japanese marketing signals, trends, or strategy..." 
                    className="w-full pl-6 pr-14 py-4 bg-slate-50 border-transparent rounded-2xl text-sm font-semibold outline-none focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all border border-slate-100"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/40 hover:bg-blue-700 active:scale-95 transition-all">
                    <Send size={18} />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                  <span className="flex items-center gap-1"><Sparkles size={10} className="text-blue-500" /> Grounded In Latest Japan Signals</span>
                  <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                  <span>AI Strategy Co-Pilot</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-in">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                    <th className="px-8 py-6">Timestamp</th>
                    <th className="px-8 py-6">Hotel Company Node</th>
                    <th className="px-8 py-6">Registry Status</th>
                    <th className="px-8 py-6">Payload Count</th>
                    <th className="px-8 py-6">Proxy Cluster</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold text-slate-600 text-sm">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-8 py-6 text-slate-400 group-hover:text-slate-900 transition-colors">{new Date(log.date).toLocaleString('en-US')}</td>
                      <td className="px-8 py-6 text-slate-900 font-bold">{log.brand} Hub</td>
                      <td className="px-8 py-6">
                        <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border ${log.status === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100/50' : 'bg-rose-50 text-rose-600 border-rose-100/50'}`}>
                          {log.status === 'success' ? 'Verified Signal' : 'Extraction Error'}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-slate-900 font-bold">+{log.found} Assets</td>
                      <td className="px-8 py-6 text-blue-600 font-extrabold text-[11px] uppercase tracking-[0.1em]">{log.proxyUsed || 'Direct Node'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Campaign Detail Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-slate-900/60 backdrop-blur-md animate-in">
          <div className="bg-white w-full max-w-3xl rounded-[2.5rem] shadow-4xl overflow-hidden border border-slate-200 relative">
            <div className="p-10 border-b border-slate-100 flex justify-between items-start">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest border ${getBrandBadgeStyle(selectedCampaign.competitor)}`}>
                    {selectedCampaign.competitor} GCM Node
                  </span>
                  <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold uppercase tracking-widest border border-slate-200">
                    {categoryLabels[selectedCampaign.category]}
                  </span>
                  {selectedCampaign.isBanner && (
                    <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-[11px] font-extrabold border border-amber-100 flex items-center gap-1 shadow-sm">
                      <Sparkles size={12} className="fill-amber-600" /> HOMEPAGE FLAGSHIP
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <h2 className="text-4xl font-extrabold text-slate-900 leading-tight tracking-tight">{selectedCampaign.name}</h2>
                  <button 
                    onClick={() => toggleFavorite(selectedCampaign.id)}
                    className="p-3 rounded-2xl border border-slate-100 bg-slate-50 hover:bg-rose-50 hover:border-rose-100 transition-colors active:scale-90"
                  >
                    <Heart 
                      size={28} 
                      className={favorites.includes(selectedCampaign.id) ? "fill-rose-500 text-rose-500" : "text-slate-400"} 
                    />
                  </button>
                </div>
              </div>
              <button onClick={() => setSelectedCampaign(null)} className="p-3 text-slate-400 hover:text-slate-900 transition-all bg-slate-50 rounded-2xl hover:bg-slate-100 active:scale-90">
                <X size={28} />
              </button>
            </div>
            
            <div className="p-10 space-y-10 max-h-[70vh] overflow-y-auto no-scrollbar">
              <div className="space-y-4">
                <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                  <FileText size={16} className="text-blue-500" /> Intelligence Payload
                </h4>
                <p className="text-slate-700 text-2xl font-semibold leading-relaxed tracking-tight">{selectedCampaign.info}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-2">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">First Discovery</span>
                  <p className="text-slate-900 text-xl font-extrabold tracking-tight">{formatDate(selectedCampaign.discoveryDate)}</p>
                </div>
                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-2">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em]">Operational Status</span>
                  <p className="text-emerald-600 text-xl font-extrabold tracking-tight flex items-center gap-2">
                    <Circle size={10} className="fill-emerald-500 text-emerald-500" />
                    {selectedCampaign.isActive ? 'Active Signal' : 'Inactive Asset'}
                  </p>
                </div>
              </div>

              <a 
                href={selectedCampaign.url} 
                target="_blank" 
                className="w-full flex items-center justify-center gap-4 py-6 rounded-3xl font-black text-lg uppercase tracking-widest transition-all bg-slate-900 text-white hover:bg-blue-600 hover:shadow-2xl shadow-blue-500/20 active:scale-95"
              >
                <ExternalLink size={24} /> VERIFY LIVE SOURCE
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
