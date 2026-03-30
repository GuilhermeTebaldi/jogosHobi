import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Users, Eye, EyeOff, RotateCcw, Play, User } from "lucide-react";
import { WORDS } from "./constants";

type GameState = "SETUP" | "PLAYING" | "FINISHED";
type ViewState = "NEUTRAL" | "REVEALED";

export default function App() {
  const [gameState, setGameState] = useState<GameState>("SETUP");
  const [viewState, setViewState] = useState<ViewState>("NEUTRAL");
  const [numPlayers, setNumPlayers] = useState(3);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [word, setWord] = useState("");
  const [impostorIndex, setImpostorIndex] = useState(-1);
  const handleBackToHub = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("gamehub:back"));
  };

  const startGame = () => {
    const randomWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    const randomImpostor = Math.floor(Math.random() * numPlayers);
    setWord(randomWord);
    setImpostorIndex(randomImpostor);
    setCurrentPlayerIndex(0);
    setViewState("NEUTRAL");
    setGameState("PLAYING");
  };

  const nextStep = () => {
    if (viewState === "NEUTRAL") {
      setViewState("REVEALED");
    } else {
      if (currentPlayerIndex < numPlayers - 1) {
        setCurrentPlayerIndex((prev) => prev + 1);
        setViewState("NEUTRAL");
      } else {
        setGameState("FINISHED");
      }
    }
  };

  const resetGame = () => {
    setGameState("SETUP");
    setViewState("NEUTRAL");
  };

  return (
    <div className="relative min-h-[100dvh] bg-gray-50 text-gray-900 font-sans overflow-hidden select-none">

      <header className="fixed top-0 left-0 right-0 z-30 px-4 py-4">
        <div className="mx-auto max-w-md bg-black/40 text-white border border-white/20 rounded-2xl backdrop-blur-md px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBackToHub}
              className="px-2.5 py-1 rounded-full border border-white/35 bg-black/25 text-[11px] font-black uppercase tracking-wide hover:bg-white/15 transition-colors"
            >
              Voltar
            </button>
            <span className="text-[11px] font-black uppercase tracking-[0.2em]">Impostor</span>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
            {numPlayers} jogadores
          </span>
        </div>
      </header>

      <main className="relative z-10 min-h-[100dvh] flex flex-col items-center justify-center p-4 sm:p-6 pt-20 sm:pt-24">
        <AnimatePresence mode="wait">
        {gameState === "SETUP" && (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md space-y-8 text-center"
          >
            <div className="space-y-2">
              <h1 className="text-4xl sm:text-5xl font-black tracking-tighter uppercase italic">Quem Sabe?</h1>
              <p className="text-gray-500 font-medium">O jogo do impostor em um só celular.</p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-400">
                  <Users size={16} />
                  <span>Jogadores</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <button
                    onClick={() => setNumPlayers(Math.max(3, numPlayers - 1))}
                    className="w-12 h-12 rounded-full border-2 border-gray-200 flex items-center justify-center text-2xl font-bold hover:bg-gray-100 transition-colors"
                  >
                    -
                  </button>
                  <span className="text-5xl sm:text-6xl font-black tabular-nums">{numPlayers}</span>
                  <button
                    onClick={() => setNumPlayers(Math.min(12, numPlayers + 1))}
                    className="w-12 h-12 rounded-full border-2 border-gray-200 flex items-center justify-center text-2xl font-bold hover:bg-gray-100 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <button
                onClick={startGame}
                className="w-full bg-gray-900 text-white py-4 sm:py-5 rounded-2xl font-bold text-lg sm:text-xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-gray-200"
              >
                <Play size={20} fill="currentColor" />
                Começar Jogo
              </button>
            </div>
          </motion.div>
        )}

        {gameState === "PLAYING" && (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full max-w-md flex flex-col items-center justify-center space-y-8 sm:space-y-12 text-center"
          >
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 bg-gray-100 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest text-gray-500">
                <User size={12} />
                Jogador {currentPlayerIndex + 1} de {numPlayers}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {viewState === "NEUTRAL" ? (
                <motion.div
                  key="neutral"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  transition={{ type: "spring", damping: 20, stiffness: 300 }}
                  className="space-y-8 flex flex-col items-center"
                >
                  <div className="space-y-4">
                    <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
                      Passe o celular para o <br />
                      <span className="text-gray-400 italic">próximo jogador</span>
                    </h2>
                    <p className="text-gray-400 font-medium">Certifique-se de que ninguém está olhando.</p>
                  </div>
                  <button
                    onClick={nextStep}
                    className="w-[min(68vw,16rem)] h-[min(68vw,16rem)] rounded-full bg-white border-8 border-gray-100 shadow-2xl flex flex-col items-center justify-center gap-4 hover:scale-105 active:scale-95 transition-all group relative overflow-hidden"
                  >
                    <motion.div 
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gray-900 flex items-center justify-center text-white group-hover:bg-gray-800 transition-colors z-10"
                    >
                      <EyeOff size={40} />
                    </motion.div>
                    <span className="font-black uppercase tracking-widest text-sm z-10">Ver Palavra</span>
                    
                    {/* Decorative background pulse */}
                    <motion.div 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }}
                      transition={{ repeat: Infinity, duration: 3 }}
                      className="absolute inset-0 bg-gray-900 rounded-full"
                    />
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="revealed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="relative w-full max-w-sm"
                >
                  {/* Shutter Animation Overlay */}
                  <motion.div 
                    initial={{ height: "50%" }}
                    animate={{ height: "0%" }}
                    transition={{ duration: 0.4, ease: "circOut" }}
                    className="absolute top-0 left-0 right-0 bg-gray-900 z-50 origin-top"
                  />
                  <motion.div 
                    initial={{ height: "50%" }}
                    animate={{ height: "0%" }}
                    transition={{ duration: 0.4, ease: "circOut" }}
                    className="absolute bottom-0 left-0 right-0 bg-gray-900 z-50 origin-bottom"
                  />

                  <motion.div
                    initial={{ scale: 0.8, opacity: 0, filter: "blur(10px)" }}
                    animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="space-y-8 sm:space-y-12 w-full py-8 sm:py-12 bg-white rounded-[2.2rem] sm:rounded-[3rem] shadow-inner border border-gray-50"
                  >
                    <div className="space-y-6 px-8">
                      <div className="flex justify-center mb-4">
                        <div className="p-3 bg-gray-100 rounded-full text-gray-900">
                          <Eye size={24} />
                        </div>
                      </div>
                      <p className="text-gray-400 font-bold uppercase tracking-[0.2em] text-xs">Sua informação secreta:</p>
                      {currentPlayerIndex === impostorIndex ? (
                        <div className="space-y-4">
                          <motion.h2 
                            initial={{ y: 10 }}
                            animate={{ y: 0 }}
                            className="text-4xl sm:text-5xl font-black text-red-500 uppercase italic leading-none"
                          >
                            Você é o <br /> Impostor
                          </motion.h2>
                          <p className="text-gray-500 font-medium max-w-[250px] mx-auto text-sm">
                            Finja que sabe a palavra e descubra o que os outros estão falando!
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <motion.h2 
                            initial={{ y: 10 }}
                            animate={{ y: 0 }}
                            className="text-5xl sm:text-6xl font-black uppercase tracking-tighter leading-none break-words text-gray-900"
                          >
                            {word}
                          </motion.h2>
                          <p className="text-gray-500 font-medium">Guarde essa palavra em segredo.</p>
                        </div>
                      )}
                    </div>

                    <div className="px-8">
                      <button
                        onClick={nextStep}
                        className="w-full bg-gray-900 text-white py-5 rounded-2xl font-bold text-xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-gray-200"
                      >
                        <EyeOff size={20} />
                        Esconder
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {gameState === "FINISHED" && (
          <motion.div
            key="finished"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="w-full max-w-md text-center space-y-8 sm:space-y-12"
          >
            <div className="space-y-4">
              <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Play size={40} fill="currentColor" className="ml-1" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-black uppercase italic leading-tight">
                Todos já viram!
              </h2>
              <p className="text-gray-500 font-medium text-base sm:text-lg">
                Comecem a rodada de perguntas. <br />
                Quem será o impostor?
              </p>
            </div>

            <div className="space-y-4">
              <button
                onClick={startGame}
                className="w-full bg-gray-900 text-white py-5 rounded-2xl font-bold text-xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-gray-200"
              >
                <RotateCcw size={20} />
                Jogar Novamente
              </button>
              <button
                onClick={resetGame}
                className="w-full bg-gray-100 text-gray-500 py-4 rounded-2xl font-bold hover:bg-gray-200 transition-all"
              >
                Voltar ao Início
              </button>
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      {/* Footer Branding */}
      <div className="fixed bottom-4 sm:bottom-8 left-0 right-0 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-300">
          Quem Sabe? &copy; 2026
        </p>
      </div>
    </div>
  );
}
