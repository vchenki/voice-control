
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, GenerateContentResponse } from '@google/genai';
import { AppStatus, HistoryItem } from './types';
import { createAudioBlob } from './utils/audioUtils';

// --- Header Component ---
const Header: React.FC = () => (
  <header className="pt-12 pb-10 px-4 text-center">
    <div className="flex flex-col items-center">
      <div className="text-[10px] font-bold tracking-[0.4em] text-indigo-600 uppercase mb-3">
        Professional Refining Studio
      </div>
      <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
        Prompt Alchemy
      </h1>
      <p className="text-slate-500 font-medium text-sm max-w-sm mx-auto">
        捕获转瞬即逝的灵感，炼制逻辑严密的 AI 指令。
      </p>
    </div>
  </header>
);

// --- History Card ---
const HistoryCard: React.FC<{ item: HistoryItem; onCopy: (text: string) => void }> = ({ item, onCopy }) => (
  <div className="studio-card p-5 rounded-2xl group relative bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all">
    <div className="flex justify-between items-center mb-4">
      <span className="text-[10px] font-bold text-slate-400 mono-font uppercase tracking-widest bg-slate-50 px-2 py-1 rounded">
        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <button 
        onClick={() => onCopy(item.optimizedPrompt)}
        className="text-indigo-600 hover:text-indigo-800 text-[11px] font-bold transition-all flex items-center gap-1.5"
      >
        <i className="fa-regular fa-copy"></i> COPY
      </button>
    </div>
    <div className="space-y-4">
      <div>
        <p className="text-[9px] uppercase font-bold text-slate-400 mb-1.5 tracking-tighter">Raw Input</p>
        <p className="text-slate-600 text-xs leading-relaxed line-clamp-2 italic">"{item.rawInput}"</p>
      </div>
      <div className="pt-3 border-t border-slate-50">
        <p className="text-[9px] uppercase font-bold text-indigo-500 mb-1.5 tracking-tighter">Optimized Result</p>
        <p className="text-slate-800 text-xs font-medium line-clamp-2">{item.optimizedPrompt}</p>
      </div>
    </div>
  </div>
);

const Footer: React.FC = () => (
  <footer className="mt-auto py-12 text-center">
    <div className="h-px bg-slate-200 w-12 mx-auto mb-6"></div>
    <p className="text-slate-400 text-[9px] tracking-[0.4em] font-bold uppercase">
      ALCHEMY • PRECISION • INTELLIGENCE
    </p>
  </footer>
);

type InputMode = 'voice' | 'text';

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  const [transcript, setTranscript] = useState('');
  const [manualText, setManualText] = useState('');
  const [optimizedPrompt, setOptimizedPrompt] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsApiKey, setNeedsApiKey] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptRef = useRef('');
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setNeedsApiKey(!hasKey);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        setNeedsApiKey(false);
      } catch (e) {
        console.error("Key selection failed", e);
      }
    }
  };

  const handleError = (msg: string) => {
    setError(msg);
    setStatus(AppStatus.ERROR);
    stopListeningInternal();
  };

  const stopListeningInternal = () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
  };

  const startListening = async () => {
    // 强制先进行密钥检查
    if (window.aistudio?.hasSelectedApiKey) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await handleSelectKey();
        // 根据指导原则，Assume key selection successful after trigger
      }
    }

    setError(null);
    setTranscript('');
    setOptimizedPrompt('');
    transcriptRef.current = '';

    try {
      const AudioCtxClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = audioCtx.createMediaStreamSource(stream);
            const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;
            scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createAudioBlob(inputData);
              sessionPromise.then(session => {
                sessionRef.current = session;
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioCtx.destination);
            setStatus(AppStatus.LISTENING);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const part = message.serverContent.inputTranscription.text;
              transcriptRef.current += part;
              setTranscript(transcriptRef.current);
            }
          },
          onerror: (e: any) => {
            console.error("Live API Error", e);
            if (e?.message?.includes('Requested entity was not found.')) {
              setNeedsApiKey(true);
              handleSelectKey();
            }
            handleError('语音引擎连接失败，请检查密钥是否正确配置。');
          },
          onclose: () => {
            if (status === AppStatus.LISTENING) stopListening();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
        }
      });
    } catch (err: any) {
      handleError('麦克风权限受阻，请确保浏览器允许访问音频。');
    }
  };

  const stopListening = async () => {
    const finalTranscript = transcriptRef.current.trim();
    stopListeningInternal();
    if (finalTranscript) {
      optimizePrompt(finalTranscript);
    } else {
      setStatus(AppStatus.IDLE);
    }
  };

  const handleManualSubmit = async () => {
    if (manualText.trim()) {
      // 文本模式同样需要检查密钥
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await handleSelectKey();
        }
      }
      optimizePrompt(manualText.trim());
    }
  };

  const optimizePrompt = async (rawInput: string) => {
    setStatus(AppStatus.OPTIMIZING);
    setOptimizedPrompt('');
    setError(null);
    let fullText = '';
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: `你是一名顶级的 AI 提示词架构师。请将以下口语化的内容转换为一个结构清晰、指令明确、具备背景设定的高质量专业提示词。
内容： "${rawInput}"
仅输出 Markdown 格式的提示词。不要包含多余说明。`,
      });

      for await (const chunk of responseStream) {
        const c = chunk as GenerateContentResponse;
        if (c.text) {
          fullText += c.text;
          setOptimizedPrompt(fullText);
        }
      }

      setHistory(prev => [{
        id: Date.now().toString(),
        timestamp: Date.now(),
        rawInput,
        optimizedPrompt: fullText
      }, ...prev]);
      setStatus(AppStatus.FINISHED);
    } catch (err: any) {
      console.error("Refining failed:", err);
      if (err?.message?.includes('Requested entity was not found.')) {
        setNeedsApiKey(true);
        handleSelectKey();
        handleError('炼制失败：未找到有效密钥或项目。请重新选择并重试。');
      } else if (err?.message?.includes('API key not valid')) {
        handleError('API 密钥无效，请点击上方配置正确的密钥。');
      } else {
        handleError('炼制过程中发生网络异常或密钥额度不足，请重试。');
      }
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen flex flex-col max-w-6xl mx-auto px-6">
      <Header />

      <main className="flex-grow flex flex-col gap-10">
        {needsApiKey && (
          <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl flex items-center justify-between mb-2 shadow-sm">
            <div className="flex items-center gap-4 text-amber-800 text-sm font-semibold">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <i className="fa-solid fa-key text-amber-600"></i>
              </div>
              <div>
                <p>密钥配置提醒</p>
                <p className="text-amber-600 text-xs font-normal">连接您的专属 API 密钥以解锁炼金全速模式。</p>
              </div>
            </div>
            <button onClick={handleSelectKey} className="px-5 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold transition-all hover:bg-amber-700 shadow-sm active:scale-95">配置密钥</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left Column: Input */}
          <section className={`studio-card p-8 rounded-[2.5rem] flex flex-col min-h-[500px] transition-all duration-300 ${status === AppStatus.LISTENING ? 'ring-2 ring-indigo-500 ring-offset-8 scale-[1.01]' : ''}`}>
            
            {/* Mode Toggle */}
            <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-6">
              <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                <button 
                  onClick={() => setInputMode('voice')}
                  disabled={status === AppStatus.LISTENING}
                  className={`px-5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${inputMode === 'voice' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 disabled:opacity-50'}`}
                >
                  <i className="fa-solid fa-microphone mr-2"></i>Voice
                </button>
                <button 
                  onClick={() => setInputMode('text')}
                  disabled={status === AppStatus.LISTENING}
                  className={`px-5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${inputMode === 'text' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 disabled:opacity-50'}`}
                >
                  <i className="fa-solid fa-keyboard mr-2"></i>Text
                </button>
              </div>
              {status === AppStatus.LISTENING && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-rose-500 rounded-full animate-ping"></div>
                  <span className="text-[10px] font-black text-rose-500 tracking-tighter">LISTENING...</span>
                </div>
              )}
            </div>
            
            <div className="flex-grow flex flex-col overflow-hidden">
              {inputMode === 'voice' ? (
                /* Voice Interface */
                <div className="flex-grow flex flex-col">
                  {status === AppStatus.IDLE ? (
                    <div className="flex-grow flex flex-col items-center justify-center text-center px-6 opacity-40">
                      <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mb-6">
                        <i className="fa-solid fa-microphone text-slate-300 text-2xl"></i>
                      </div>
                      <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-[200px]">点击下方按钮开始捕获您的语音灵感</p>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-slate-800 leading-snug overflow-y-auto max-h-[300px] pr-2 scrollbar-thin">
                      {transcript || (status === AppStatus.LISTENING ? "准备中..." : "")}
                      {status === AppStatus.LISTENING && <span className="inline-block w-0.5 h-6 bg-indigo-500 ml-1 animate-pulse"></span>}
                    </div>
                  )}
                  <div className="mt-auto pt-10 flex justify-center">
                    {status === AppStatus.LISTENING ? (
                      <button onClick={stopListening} className="recording-ring w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center text-white shadow-xl hover:scale-105 transition-transform active:scale-95">
                        <i className="fa-solid fa-stop text-lg"></i>
                      </button>
                    ) : (
                      <button 
                        onClick={startListening} 
                        disabled={status === AppStatus.OPTIMIZING}
                        className="primary-button w-20 h-20 rounded-full flex items-center justify-center shadow-xl disabled:opacity-50 hover:scale-105 transition-transform active:scale-95"
                      >
                        <i className="fa-solid fa-microphone text-2xl"></i>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Text Interface */
                <div className="flex-grow flex flex-col">
                  <textarea 
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="在此处输入或粘贴您的原始想法、大纲或口语化描述..."
                    className="flex-grow bg-slate-50/50 rounded-3xl p-8 text-slate-700 text-sm font-medium resize-none border border-slate-100 focus:border-indigo-200 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all scrollbar-thin leading-relaxed"
                  />
                  <div className="mt-8 flex justify-center">
                    <button 
                      onClick={handleManualSubmit}
                      disabled={!manualText.trim() || status === AppStatus.OPTIMIZING}
                      className="w-full py-5 bg-slate-900 text-white rounded-2xl font-bold text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all hover:bg-slate-800 hover:shadow-lg disabled:opacity-20 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      <i className="fa-solid fa-wand-magic-sparkles text-sm text-indigo-400"></i>
                      Refine Content
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Right Column: Output */}
          <section className="studio-card p-8 rounded-[2.5rem] flex flex-col min-h-[500px] relative bg-white border border-slate-100">
            <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-6">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${status === AppStatus.OPTIMIZING ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`}></span>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Refined Result</h3>
              </div>
            </div>
            
            <div className="flex-grow flex flex-col">
              {status === AppStatus.OPTIMIZING || (status === AppStatus.FINISHED && optimizedPrompt) ? (
                <div className="h-full flex flex-col animate-in fade-in duration-500">
                  <div className="flex-grow bg-slate-50/30 rounded-3xl p-8 mono-font text-[13px] text-slate-700 whitespace-pre-wrap overflow-y-auto max-h-[340px] leading-relaxed border border-slate-100/50 cursor-active selection:bg-indigo-100">
                    {optimizedPrompt}
                  </div>
                  {status === AppStatus.FINISHED && (
                    <div className="mt-8 flex gap-3">
                      <button onClick={() => handleCopy(optimizedPrompt)} className="flex-1 primary-button py-4 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-indigo-100">
                        <i className="fa-regular fa-copy"></i> Copy Prompt
                      </button>
                      <button onClick={() => setStatus(AppStatus.IDLE)} className="secondary-button px-6 rounded-2xl transition-colors text-rose-500 hover:bg-rose-50 border-rose-100/50">
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  )}
                </div>
              ) : status === AppStatus.ERROR ? (
                <div className="flex-grow flex flex-col items-center justify-center text-center p-8 bg-rose-50/50 rounded-3xl border border-rose-100 animate-in slide-in-from-bottom-2 duration-300">
                   <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mb-6">
                      <i className="fa-solid fa-circle-exclamation text-rose-500 text-2xl"></i>
                   </div>
                   <p className="text-rose-900 font-bold text-sm mb-2">炼制中断</p>
                   <p className="text-rose-600 text-xs mb-8 max-w-[200px] leading-relaxed">{error}</p>
                   <button onClick={() => setStatus(AppStatus.IDLE)} className="px-8 py-2.5 bg-rose-500 text-white rounded-xl font-bold text-[10px] uppercase tracking-wider hover:bg-rose-600 transition-all shadow-md active:scale-95">Dismiss & Retry</button>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center opacity-10">
                  <i className="fa-solid fa-sparkles text-slate-400 text-5xl mb-6"></i>
                  <p className="text-slate-500 font-bold uppercase tracking-[0.4em] text-[10px]">Awaiting Essence</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Archives */}
        {history.length > 0 && (
          <section className="mt-16 pb-20">
            <div className="flex items-center gap-6 mb-12">
              <span className="text-[10px] font-black uppercase tracking-[0.6em] text-slate-300">Archives Vault</span>
              <div className="h-px flex-grow bg-slate-100"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {history.map(item => <HistoryCard key={item.id} item={item} onCopy={handleCopy} />)}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
