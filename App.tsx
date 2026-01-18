
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
        捕获转瞬即逝的语音灵感，炼制逻辑严密的 AI 指令。
      </p>
    </div>
  </header>
);

// --- History Card ---
const HistoryCard: React.FC<{ item: HistoryItem; onCopy: (text: string) => void }> = ({ item, onCopy }) => (
  <div className="studio-card p-5 rounded-2xl group relative">
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
        <p className="text-slate-600 text-xs leading-relaxed line-clamp-2">"{item.rawInput}"</p>
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

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [transcript, setTranscript] = useState('');
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
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setNeedsApiKey(!hasKey);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      await window.aistudio.openSelectKey();
      setNeedsApiKey(false);
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
    // 按照指导原则，如果可能存在竞态，假设选择成功并继续
    if (needsApiKey) {
      await handleSelectKey();
    }

    setError(null);
    setTranscript('');
    setOptimizedPrompt('');
    transcriptRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = audioCtx.createMediaStreamSource(stream);
            const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
            // 关键：将引用存入 Ref，防止被垃圾回收
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createAudioBlob(inputData);
              // 按照指导原则，通过 sessionPromise 发送数据以避免闭包陷阱
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
            console.error('Live API Error:', e);
            if (e?.message?.includes('Requested entity was not found.')) {
              setNeedsApiKey(true);
              handleSelectKey();
            }
            handleError('语音引擎连接中断，请检查网络或密钥。');
          },
          onclose: () => {
            console.log('Live API Connection Closed');
            // 如果是在录制中途非预期关闭
            if (status === AppStatus.LISTENING) {
              stopListening();
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
        }
      });
    } catch (err: any) {
      console.error('Media Access Error:', err);
      handleError('无法获取麦克风权限。');
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

  const optimizePrompt = async (rawInput: string) => {
    setStatus(AppStatus.OPTIMIZING);
    setOptimizedPrompt('');
    let fullText = '';
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: `你是一名顶级的 AI 提示词架构师。请将以下口语化的语音转录内容转换为一个结构清晰、指令明确、具备背景设定的高质量专业提示词。
内容： "${rawInput}"
仅输出 Markdown 格式的提示词。不要包含多余说明。`,
      });

      for await (const chunk of responseStream) {
        const c = chunk as GenerateContentResponse;
        fullText += c.text;
        setOptimizedPrompt(fullText);
      }

      setHistory(prev => [{
        id: Date.now().toString(),
        timestamp: Date.now(),
        rawInput,
        optimizedPrompt: fullText
      }, ...prev]);
      setStatus(AppStatus.FINISHED);
    } catch (err: any) {
      if (err?.message?.includes('Requested entity was not found.')) {
        setNeedsApiKey(true);
        handleSelectKey();
      }
      handleError('提示词炼制失败，请重试。');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleRegenerate = () => {
    if (transcriptRef.current.trim()) {
      optimizePrompt(transcriptRef.current);
    }
  };

  return (
    <div className="min-h-screen flex flex-col max-w-6xl mx-auto px-6">
      <Header />

      <main className="flex-grow flex flex-col gap-10">
        
        {needsApiKey && (
          <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 text-amber-800 text-xs font-semibold">
              <i className="fa-solid fa-key"></i>
              <span>连接您的专属 API 密钥以解锁炼金全速模式。</span>
            </div>
            <button onClick={handleSelectKey} className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold transition-all hover:bg-amber-700">配置密钥</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* 左侧：输入/转录卡片 */}
          <section className={`studio-card p-8 rounded-[2rem] flex flex-col min-h-[460px] ${status === AppStatus.LISTENING ? 'ring-2 ring-indigo-500 ring-offset-4' : ''}`}>
            <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-4">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${status === AppStatus.LISTENING ? 'bg-rose-500' : 'bg-slate-300'}`}></span>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Capture Input</h3>
              </div>
              {status === AppStatus.LISTENING && (
                <span className="text-[10px] font-bold text-rose-500 animate-pulse">RECORDING...</span>
              )}
            </div>
            
            <div className="flex-grow flex flex-col overflow-hidden">
              {status === AppStatus.IDLE ? (
                <div className="flex-grow flex flex-col items-center justify-center text-center px-6">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <i className="fa-solid fa-microphone text-slate-300 text-xl"></i>
                  </div>
                  <p className="text-slate-400 text-sm font-medium leading-relaxed">
                    点击下方录音，说出您的想法。<br/>我们将为您捕捉每一个细微的灵感。
                  </p>
                </div>
              ) : (
                <div className="text-2xl font-bold text-slate-800 leading-snug overflow-y-auto max-h-[300px] pr-2 scrollbar-thin">
                  {transcript || (status === AppStatus.LISTENING ? "正在倾听您的灵感..." : "")}
                  {status === AppStatus.LISTENING && <span className="inline-block w-0.5 h-6 bg-indigo-500 ml-1 animate-pulse"></span>}
                </div>
              )}
            </div>

            <div className="mt-10 flex justify-center">
              {status === AppStatus.LISTENING ? (
                <button onClick={stopListening} className="recording-ring w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 active:scale-95">
                  <i className="fa-solid fa-square text-lg"></i>
                </button>
              ) : (
                <button 
                  onClick={startListening} 
                  disabled={status === AppStatus.OPTIMIZING}
                  className="primary-button w-16 h-16 rounded-full flex items-center justify-center shadow-lg disabled:opacity-50 transition-transform hover:scale-105 active:scale-95"
                >
                  <i className="fa-solid fa-microphone text-xl"></i>
                </button>
              )}
            </div>
          </section>

          {/* 右侧：结果/精炼卡片 */}
          <section className="studio-card p-8 rounded-[2rem] flex flex-col min-h-[460px] relative">
            <div className="flex items-center justify-between mb-8 border-b border-slate-50 pb-4">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${status === AppStatus.OPTIMIZING ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`}></span>
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Refined Prompt</h3>
              </div>
            </div>
            
            <div className="flex-grow flex flex-col">
              {status === AppStatus.OPTIMIZING || (status === AppStatus.FINISHED && optimizedPrompt) ? (
                <div className="h-full flex flex-col">
                  <div className="flex-grow bg-slate-50/50 rounded-2xl p-6 mono-font text-[13px] text-slate-700 whitespace-pre-wrap overflow-y-auto max-h-[320px] leading-relaxed border border-slate-100 cursor-active">
                    {optimizedPrompt}
                  </div>
                  
                  {status === AppStatus.FINISHED && (
                    <div className="mt-8 flex gap-3">
                      <button onClick={() => handleCopy(optimizedPrompt)} className="flex-1 primary-button py-3 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                        <i className="fa-regular fa-copy"></i> Copy
                      </button>
                      <button onClick={handleRegenerate} className="secondary-button px-5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                        <i className="fa-solid fa-arrows-rotate"></i>
                      </button>
                      <button onClick={() => setStatus(AppStatus.IDLE)} className="secondary-button px-5 rounded-xl transition-colors text-rose-500 hover:bg-rose-50 border-rose-100">
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  )}
                </div>
              ) : status === AppStatus.ERROR ? (
                <div className="flex-grow flex flex-col items-center justify-center text-center p-6 bg-rose-50/50 rounded-2xl border border-rose-100">
                   <i className="fa-solid fa-circle-exclamation text-rose-400 text-2xl mb-4"></i>
                   <p className="text-rose-900 font-bold text-sm mb-6">{error}</p>
                   <button onClick={handleRegenerate} className="px-6 py-2 bg-rose-500 text-white rounded-lg font-bold text-xs uppercase transition-all hover:bg-rose-600">
                     Retry Alchemy
                   </button>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center opacity-30">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                    <i className="fa-solid fa-wand-sparkles text-slate-400 text-xl"></i>
                  </div>
                  <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px]">Awaiting Essence</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* 历史档案区 */}
        {history.length > 0 && (
          <section className="mt-12 pb-12">
            <div className="flex items-center gap-4 mb-10 opacity-60">
              <span className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-400">Archives</span>
              <div className="h-px flex-grow bg-slate-200"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {history.map(item => (
                <HistoryCard key={item.id} item={item} onCopy={handleCopy} />
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
