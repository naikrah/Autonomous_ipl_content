import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { 
  Bot, Eye, BrainCircuit, Send, Power, 
  Settings2, Activity, AlertTriangle, CheckCircle2,
  Terminal, Zap, Search, Twitter, Hash, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- CONFIGURATION ---
const KEYWORDS = ["WICKET", "FOUR", "SIX", "OUT", "RUN OUT", "NO BALL", "50", "100", "CENTURY", "FIFTY", "WIN", "WON", "LOSS", "DROPPED"];
const PERSONALITIES = ["hype", "analysis", "debate", "tension"];

const SYSTEM_PROMPT = `You are an autonomous sports content engine acting as a live cricket commentator for social media.

OBJECTIVE:
Convert match events into short, original, engaging posts (max 30 words).

STRICT RULES:
- DO NOT copy or rephrase the input text directly.
- ALWAYS create original content.
- Be aware of the MATCH CONTEXT provided (e.g., if a wicket just fell before this, mention the pressure).
- ALWAYS include 2-3 official hashtags at the end (e.g., #RCBvSRH #IPL2026).
- ONLY output the final post text.
- If the event is trivial, output exactly: SKIP

GOAL:
Make it feel like a passionate human reacting live, understanding the flow of the game.`;

interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'detect' | 'brain' | 'publish' | 'warn';
  message: string;
}

interface PublishedPost {
  id: string;
  event: string;
  post: string;
  personality: string;
  time: string;
  overMarker?: string;
}

export default function App() {
  const [matchQuery, setMatchQuery] = useState('RCB vs SRH');
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [posts, setPosts] = useState<PublishedPost[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const postsRef = useRef<PublishedPost[]>([]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);
  
  // Engine State
  const [currentPersonality, setCurrentPersonality] = useState(PERSONALITIES[0]);
  const [stats, setStats] = useState({ scanned: 0, detected: 0, published: 0, apiCallsSaved: 0 });
  
  // Refs for background loop (Decisive Deduplication)
  const processedOversRef = useRef<Set<string>>(new Set());
  const lastEventRef = useRef<string>('');
  const isProcessingRef = useRef(false);

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [{
      id: Math.random().toString(36).substring(7),
      time: new Date().toLocaleTimeString([], { hour12: false }),
      type,
      message
    }, ...prev].slice(0, 50));
  };

  const getAI = () => {
    const key = userApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("API Key missing. Please add it in Settings.");
    return new GoogleGenAI({ apiKey: key });
  };

  // --- THE ORGANISM LOOP ---
  useEffect(() => {
    if (!isAutoPilot) {
      addLog('warn', 'Engine offline. Auto-pilot disengaged.');
      return;
    }

    if (!matchQuery.trim()) {
      addLog('warn', 'No match query provided. Disengaging auto-pilot.');
      setIsAutoPilot(false);
      return;
    }

    addLog('info', `Engine online. Tracking: ${matchQuery}. Heartbeat started.`);
    
    let timeoutId: NodeJS.Timeout;
    let isMounted = true;

    const runHeartbeat = async () => {
      if (!isMounted || !isAutoPilot) return;
      if (isProcessingRef.current) {
        timeoutId = setTimeout(runHeartbeat, 5000);
        return;
      }
      isProcessingRef.current = true;
      let nextDelay = 15000; // Default 15 seconds
      
      try {
        // 1. The Eyes (Fetch Data from Google Search)
        addLog('info', `[EYES] Searching Google for latest updates on ${matchQuery}...`);
        
        const ai = getAI();
        const searchPrompt = `Current Date and Time: ${new Date().toLocaleString()}
Search Google for the LATEST live commentary or live score update for the cricket match: ${matchQuery}.

CRITICAL RULES:
1. ONLY return data for a match that is currently live or happened within the last 24 hours.
2. If the match is old, not happening right now, or you cannot find real-time updates, YOU MUST RETURN EXACTLY: "NO_RECENT_MATCH_FOUND". Do NOT hallucinate or make up events.
3. If a recent/live match is found, return ONLY the most recent single ball-by-ball update or significant event.
4. Format it exactly like this: "[Score/Over] - [Event Description]". 
Example: "125/4 (13.5) - WICKET! Rohit edges it to slip."
It is CRITICAL that you include the over number in parentheses like (13.5) if it's a live ball.
5. If the match has officially concluded, you MUST include the exact phrase "MATCH OVER" in your response.`;

        const searchResponse = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: searchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1,
          }
        });

        const currentEvent = searchResponse.text?.trim() || '';
        
        if (!currentEvent || currentEvent.includes("NO_RECENT_MATCH_FOUND")) {
          addLog('warn', '[EYES] No live or recent match found. Waiting 60s...');
          nextDelay = 60000; // Wait 60s if no match found
          return;
        }

        const isMatchOver = ["WON BY", "WIN BY", "WINS BY", "MATCH OVER", "END OF MATCH", "VICTORY FOR", "BEAT ", "BEATS ", "STUMPS", "DRAWN", "ABANDONED", "NO RESULT"].some(kw => currentEvent.toUpperCase().includes(kw));

        // Dynamic Delay Logic to save API calls
        const eventUpper = currentEvent.toUpperCase();
        if (eventUpper.includes("TOSS") && (eventUpper.includes("ELECTED TO") || eventUpper.includes("WON THE TOSS"))) {
          nextDelay = 15 * 60 * 1000; // 15 mins
          addLog('info', `[SYSTEM] Toss detected. Taking a 15-minute break before innings start...`);
        } else if (eventUpper.includes("STRATEGIC TIMEOUT") || eventUpper.includes("TIME OUT")) {
          nextDelay = 2.5 * 60 * 1000; // 2.5 mins
          addLog('info', `[SYSTEM] Strategic Timeout detected. Taking a 2.5-minute break...`);
        } else if (eventUpper.includes("INNINGS BREAK") || eventUpper.includes("END OF INNINGS")) {
          nextDelay = 10 * 60 * 1000; // 10 mins
          addLog('info', `[SYSTEM] Innings Break detected. Taking a 10-minute break...`);
        } else {
          // Check if it's the end of an over (e.g., 14.6)
          const overMatch = currentEvent.match(/\((\d+\.\d+)\)/);
          if (overMatch && overMatch[1].endsWith(".6")) {
            nextDelay = 45 * 1000; // 45 seconds
            addLog('info', `[SYSTEM] End of over detected. Taking a 45-second break...`);
          }
        }

        if (currentEvent === lastEventRef.current) {
          if (isMatchOver) {
            addLog('info', `[SYSTEM] Match is already concluded. Disengaging auto-pilot.`);
            setIsAutoPilot(false);
          }
          return;
        }
        lastEventRef.current = currentEvent;

        setStats(s => ({ ...s, scanned: s.scanned + 1 }));
        
        // 2. The Brain Stem (Strict Ball-by-Ball Deduplication)
        // Extract the over marker, e.g., (14.2)
        const overMatch = currentEvent.match(/\((\d+\.\d+)\)/);
        const overMarker = overMatch ? overMatch[1] : null;

        if (overMarker && processedOversRef.current.has(overMarker)) {
           addLog('warn', `[REFLEX] Ball ${overMarker} already processed. API call saved.`);
           setStats(s => ({ ...s, apiCallsSaved: s.apiCallsSaved + 1 }));
           return;
        }

        addLog('info', `[EYES] Scanned: ${currentEvent.substring(0, 50)}...`);

        const isSignificant = KEYWORDS.some(kw => currentEvent.toUpperCase().includes(kw)) || isMatchOver;
        
        if (!isSignificant) {
          // Mark as processed even if insignificant so we don't scan it again
          if (overMarker) processedOversRef.current.add(overMarker);
          return; 
        }

        // We have a valid, new, significant event
        if (overMarker) processedOversRef.current.add(overMarker);
        setStats(s => ({ ...s, detected: s.detected + 1 }));
        
        if (isMatchOver) {
          addLog('detect', `[REFLEX] Match End detected: ${currentEvent}`);
        } else {
          addLog('detect', `[REFLEX] Significant event detected at ${overMarker || 'unknown'}: ${currentEvent}`);
        }

        // 3. The Brain (Gemini with Context Awareness)
        const nextPersonality = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
        setCurrentPersonality(nextPersonality);
        
        addLog('brain', `[BRAIN] Generating post with context... (Mode: ${nextPersonality.toUpperCase()})`);

        // Build Context from last 3 posts
        const recentContext = postsRef.current.slice(0, 3).map(p => p.event).join('\\n');
        
        // Generate Hashtags based on query (e.g., "RCB vs SRH" -> "#RCBvSRH")
        const teamTags = matchQuery.split('vs').map(t => t.trim().toUpperCase());
        const suggestedHashtag = teamTags.length === 2 ? `#${teamTags[0]}v${teamTags[1]}` : `#${matchQuery.replace(/\s+/g, '')}`;

        let postPrompt = "";
        if (isMatchOver) {
          postPrompt = `MATCH: ${matchQuery}
SUGGESTED HASHTAGS: ${suggestedHashtag} #IPL2026

CRITICAL INSTRUCTION: The match has ENDED. 
FINAL UPDATE: ${currentEvent}

Write a short, exciting summary post (max 40 words) announcing the final result and the winner. Do not act like the match is still going. Include the hashtags.`;
        } else {
          postPrompt = `MATCH: ${matchQuery}
SUGGESTED HASHTAGS: ${suggestedHashtag} #IPL2026

RECENT MATCH CONTEXT (Last 3 events):
${recentContext || "Match just started or no recent major events."}

NEW EVENT TO POST ABOUT: 
${currentEvent}

CRITICAL INSTRUCTION: You are in "${nextPersonality.toUpperCase()}" mode. Adjust your tone to match this personality exactly. Remember the context if it's relevant (e.g. back-to-back wickets).`;
        }
        
        const postResponse = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: postPrompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.8,
          }
        });

        const postText = postResponse.text?.trim() || 'SKIP';

        // 4. The Hands (Posting Engine)
        if (postText !== 'SKIP') {
          addLog('publish', `[HANDS] Ready to publish to timeline...`);
          setPosts(prev => [{
            id: Date.now().toString(),
            event: currentEvent,
            post: postText,
            personality: isMatchOver ? 'summary' : nextPersonality,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            overMarker: isMatchOver ? 'FINAL' : (overMarker || 'Live')
          }, ...prev]);
          setStats(s => ({ ...s, published: s.published + 1 }));
          
          if (isMatchOver) {
            addLog('info', `[SYSTEM] Match concluded. Final summary generated. Disengaging auto-pilot.`);
            setIsAutoPilot(false);
          }
        } else {
          addLog('warn', `[BRAIN] Event filtered out by AI logic (SKIP).`);
        }
      } catch (err) {
        addLog('warn', `[ERROR] Neural misfire: ${err}`);
      } finally {
        isProcessingRef.current = false;
        if (isMounted && isAutoPilot) {
          timeoutId = setTimeout(runHeartbeat, nextDelay);
        }
      }

    };

    runHeartbeat();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [isAutoPilot, matchQuery]); // Removed posts from dependency array to prevent heartbeat restarts

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 font-mono selection:bg-emerald-500/30 selection:text-emerald-200">
      
      {/* Top Navigation / Status Bar */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-10 h-10 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <Bot className="w-5 h-5 text-emerald-400" />
              {isAutoPilot && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div>
              <h1 className="text-white font-semibold tracking-tight">Autonomous Content Engine</h1>
              <div className="text-xs text-emerald-500/70 flex items-center gap-1">
                <Activity className="w-3 h-3" /> System Online (Live Search)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text"
                value={matchQuery}
                onChange={(e) => setMatchQuery(e.target.value)}
                disabled={isAutoPilot}
                placeholder="Match to track (e.g. RCB vs SRH)"
                className="bg-[#111] border border-white/10 rounded-md py-1.5 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 transition-colors w-64"
              />
            </div>
            <button
              onClick={() => setIsAutoPilot(!isAutoPilot)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all duration-300 ${
                isAutoPilot 
                  ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' 
                  : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20'
              }`}
            >
              <Power className="w-4 h-4" />
              {isAutoPilot ? 'DISENGAGE AUTO-PILOT' : 'ENGAGE AUTO-PILOT'}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-md bg-slate-800/50 text-slate-400 hover:text-white border border-white/10 transition-colors"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'EVENTS SCANNED', value: stats.scanned, icon: Eye, color: 'text-blue-400' },
            { label: 'SIGNIFICANT DETECTED', value: stats.detected, icon: Zap, color: 'text-amber-400' },
            { label: 'POSTS GENERATED', value: stats.published, icon: Send, color: 'text-emerald-400' },
            { label: 'API CALLS SAVED', value: stats.apiCallsSaved, icon: CheckCircle2, color: 'text-indigo-400' },
            { label: 'CURRENT MODE', value: currentPersonality.toUpperCase(), icon: BrainCircuit, color: 'text-purple-400' },
          ].map((stat, i) => (
            <div key={i} className="bg-[#111] border border-white/5 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-semibold tracking-wider">{stat.label}</span>
                <stat.icon className={`w-4 h-4 ${stat.color} opacity-70`} />
              </div>
              <div className={`text-2xl font-light ${stat.color}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Column: The Nervous System (Logs) */}
          <div className="flex flex-col h-[600px]">
            <div className="flex items-center gap-2 mb-4 text-sm text-slate-400 font-semibold tracking-wider">
              <Terminal className="w-4 h-4" />
              SYSTEM LOGS (NERVOUS SYSTEM)
            </div>
            <div className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden flex flex-col relative shadow-2xl">
              <div className="absolute top-0 left-0 w-full h-8 bg-gradient-to-b from-[#0a0a0a] to-transparent z-10 pointer-events-none" />
              <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs flex flex-col-reverse">
                <AnimatePresence>
                  {logs.map((log) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex gap-3 leading-relaxed"
                    >
                      <span className="text-slate-600 shrink-0">[{log.time}]</span>
                      <span className={`
                        ${log.type === 'info' ? 'text-blue-400/80' : ''}
                        ${log.type === 'detect' ? 'text-amber-400' : ''}
                        ${log.type === 'brain' ? 'text-purple-400' : ''}
                        ${log.type === 'publish' ? 'text-emerald-400' : ''}
                        ${log.type === 'warn' ? 'text-red-400' : ''}
                      `}>
                        {log.message}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right Column: The Hands (Publishing Queue / Timeline) */}
          <div className="flex flex-col h-[600px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-400 font-semibold tracking-wider">
                <Send className="w-4 h-4" />
                READY TO POST (MANUAL APPROVAL)
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Settings2 className="w-3 h-3" /> Vercel / Mobile Ready
              </div>
            </div>
            
            <div className="flex-1 bg-[#111] border border-white/10 rounded-xl overflow-y-auto p-4 space-y-4">
              {posts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-3">
                  <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center">
                    <Send className="w-5 h-5 opacity-50" />
                  </div>
                  <p className="text-sm">Waiting for significant events...</p>
                </div>
              ) : (
                <AnimatePresence>
                  {posts.map((post) => (
                    <motion.div
                      key={post.id}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="bg-[#1a1a1a] border border-white/5 rounded-lg p-5 relative group"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
                            AI
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-200">CricketBot</div>
                            <div className="text-xs text-slate-500">@cricket_auto • {post.time}</div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            Over {post.overMarker}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">
                            {post.personality}
                          </span>
                        </div>
                      </div>
                      
                      <p className="text-slate-200 text-sm leading-relaxed mb-4 font-sans whitespace-pre-wrap">
                        {post.post}
                      </p>
                      
                      <div className="bg-black/30 rounded p-3 border border-white/5 mb-3">
                        <div className="text-xs text-slate-500 mb-1 font-semibold">TRIGGER EVENT:</div>
                        <div className="text-xs text-slate-400 italic">"{post.event}"</div>
                      </div>
                      
                      <div className="flex justify-end">
                        <a
                          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.post)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-4 py-2 bg-[#1DA1F2] text-white hover:bg-[#1a8cd8] rounded-full text-sm font-bold transition-colors shadow-lg shadow-[#1DA1F2]/20"
                        >
                          <Twitter className="w-4 h-4 fill-current" />
                          Post
                        </a>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>

        </div>
      </main>
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#111] border border-white/10 rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-emerald-500" />
                  Settings
                </h2>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Gemini API Key
                  </label>
                  <input
                    type="password"
                    value={userApiKey}
                    onChange={(e) => {
                      setUserApiKey(e.target.value);
                      localStorage.setItem('gemini_api_key', e.target.value);
                    }}
                    placeholder="AIzaSy..."
                    className="w-full bg-black border border-white/10 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    Your API key is stored locally in your browser and is never sent to our servers. Required for Vercel deployment.
                  </p>
                </div>
              </div>
              <div className="p-4 border-t border-white/10 bg-black/20 flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md text-sm font-medium transition-colors"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
