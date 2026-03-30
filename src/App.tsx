import { useMemo, useRef, useState, useEffect, type ComponentType, type ReactNode } from "react";
import { motion } from "motion/react";
import { TowerControl as Tower, Brain, Target, ChevronRight, User } from "lucide-react";
import TorreGame from "../TORRE/src/App.tsx";
import Torre2SinalGame from "../TORRE2SINAL/src/App.tsx";
import ReflexoGame from "../4-5-6REFLEXO/src/App.tsx";
import CorAlvoGame from "../CorAlvo/src/App.tsx";
import ImpostorGame from "../IMPOSTOR/src/App.tsx";

type GameId = "impostor" | "coralvo" | "memoria" | "torre" | "torre2sinal";

interface Game {
  id: GameId;
  title: string;
  description: string;
  image: string;
  color: string;
  icon: ReactNode;
  component: ComponentType;
}

const publicGames: Game[] = [
  {
    id: "impostor",
    title: "IMPOSTOR",
    description: "Cada jogador vê sua pista secreta, menos o impostor. Descubra quem está fingindo.",
    image: "https://i.pinimg.com/736x/1e/fd/a7/1efda7cd7b4f73c0f12542d3f9439c96.jpg",
    color: "from-red-700/80 to-black",
    icon: <User size={24} />,
    component: ImpostorGame,
  },
  {
    id: "coralvo",
    title: "CORALVO",
    description: "Teste sua precisão e reflexos neste desafio de mira. Acerte o alvo no momento certo.",
    image: "https://i.pinimg.com/1200x/0e/dd/08/0edd08345b75461aee9fcbae3fef548f.jpg",
    color: "from-emerald-600/80 to-black",
    icon: <Target size={24} />,
    component: CorAlvoGame,
  },
  {
    id: "memoria",
    title: "4-5-6REFLEXO",
    description: "Novo desafio de reflexo visual: memorize números de 4, 5 ou 6 dígitos em milissegundos.",
    image: "https://i.pinimg.com/1200x/d9/35/c8/d935c8606522951393dcaad81dcaea75.jpg",
    color: "from-blue-600/80 to-black",
    icon: <Brain size={24} />,
    component: ReflexoGame,
  },
  {
    id: "torre",
    title: "TORRE",
    description: "Desafie a gravidade e construa a estrutura mais alta possível. Equilíbrio é a chave para a vitória.",
    image: "https://i.pinimg.com/736x/03/ae/ea/03aeea01ff701ac443319759a062f160.jpg",
    color: "from-orange-600/80 to-black",
    icon: <Tower size={24} />,
    component: TorreGame,
  },
];

const secretSignalGame: Game = {
  id: "torre2sinal",
  title: "TORRE 2 SINAL",
  description: "Modo oculto de análise forense com telemetria avançada e cartaz técnico em alta qualidade.",
  image: "https://i.pinimg.com/736x/03/ae/ea/03aeea01ff701ac443319759a062f160.jpg",
  color: "from-cyan-600/80 to-black",
  icon: <Tower size={24} />,
  component: Torre2SinalGame,
};

const SECRET_MENU_TAP_WINDOW_MS = 1800;
const SECRET_MENU_TAP_TARGET = 5;

export default function App() {
  const [activeGameId, setActiveGameId] = useState<GameId | null>(null);
  const [secretUnlocked, setSecretUnlocked] = useState(false);
  const hubTapTimesRef = useRef<number[]>([]);

  const menuGames = useMemo(() => (
    secretUnlocked || activeGameId === "torre2sinal"
      ? [...publicGames, secretSignalGame]
      : publicGames
  ), [activeGameId, secretUnlocked]);

  const activeGame = useMemo(
    () => menuGames.find((game) => game.id === activeGameId) ?? null,
    [activeGameId, menuGames],
  );

  const ActiveGameComponent = activeGame?.component;
  const isGameOpen = activeGameId !== null;
  const openGame = (gameId: GameId | null) => {
    if (gameId === "torre2sinal" && !secretUnlocked) return;
    setActiveGameId(gameId);
  };
  useEffect(() => {
    const handleBackToHub = () => {
      setActiveGameId(null);
    };
    window.addEventListener("gamehub:back", handleBackToHub);
    return () => {
      window.removeEventListener("gamehub:back", handleBackToHub);
    };
  }, []);
  const handleHubSecretTap = () => {
    if (isGameOpen || secretUnlocked) return;
    const now = Date.now();
    const recent = hubTapTimesRef.current.filter((timestamp) => now - timestamp <= SECRET_MENU_TAP_WINDOW_MS);
    recent.push(now);
    hubTapTimesRef.current = recent;
    if (recent.length >= SECRET_MENU_TAP_TARGET) {
      setSecretUnlocked(true);
      hubTapTimesRef.current = [];
    }
  };
  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-white/20">
      {!isGameOpen && (
        <header className="fixed top-0 left-0 w-full z-[300] px-4 py-4 md:px-6">
          <div className="max-w-7xl mx-auto rounded-2xl border border-white/10 bg-black/65 backdrop-blur-xl px-4 py-3 md:px-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <button
              onClick={() => openGame(null)}
              className="flex items-center gap-2 w-fit"
            >
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 bg-black rotate-45" />
              </div>
              <span className="font-black tracking-tighter text-xl">GAMEHUB</span>
            </button>

            <nav className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
              <button
                onClick={() => openGame(null)}
                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border bg-white text-black border-white"
              >
                Hub
              </button>
              {menuGames.map((game) => (
                <button
                  key={game.id}
                  onClick={() => openGame(game.id)}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border bg-white/5 border-white/15 hover:bg-white/10 transition-colors"
                >
                  {game.title}
                </button>
              ))}
            </nav>
          </div>
        </header>
      )}

      {ActiveGameComponent ? (
        <main>
          <ActiveGameComponent />
        </main>
      ) : (
        <>
          <main className="pt-36 pb-12 px-4 md:px-8 max-w-7xl mx-auto">
            <div className="mb-12">
              <motion.h1
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-4xl md:text-6xl font-black tracking-tighter mb-2"
              >
                ESCOLHA SEU JOGO
              </motion.h1>
              {secretUnlocked && (
                <p className="text-emerald-300 font-mono text-[10px] uppercase tracking-widest mb-1">
                  Torre 2 Sinal liberado
                </p>
              )}
              <motion.p
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="text-gray-500 font-mono text-xs uppercase tracking-widest"
              >
                Quatro desafios aguardam por você
              </motion.p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {menuGames.map((game, index) => (
                <motion.button
                  key={game.id}
                  type="button"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => openGame(game.id)}
                  className="relative text-left group cursor-pointer overflow-hidden rounded-3xl aspect-[4/5]"
                >
                  <img
                    src={game.image}
                    alt={game.title}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />

                  <div
                    className={`absolute inset-0 bg-gradient-to-t ${game.color} opacity-60 group-hover:opacity-80 transition-opacity duration-500`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

                  <div className="absolute inset-0 p-8 flex flex-col justify-end">
                    <div className="mb-4 p-3 bg-white/10 backdrop-blur-md rounded-2xl w-fit border border-white/20">
                      {game.icon}
                    </div>
                    <h2 className="text-4xl font-black tracking-tighter mb-2 group-hover:translate-x-2 transition-transform duration-300">
                      {game.title}
                    </h2>
                    <p className="text-sm text-gray-300 line-clamp-2 mb-6 opacity-0 group-hover:opacity-100 transition-opacity duration-500 transform translate-y-4 group-hover:translate-y-0">
                      {game.description}
                    </p>
                    <div className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
                      <span>Jogar Agora</span>
                      <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </main>

          <footer className="p-8 text-center md:text-left border-t border-white/5 mt-12">
            <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6 opacity-40 font-mono text-[10px] uppercase tracking-widest">
              <div className="flex gap-8">
                <button
                  type="button"
                  onPointerDown={handleHubSecretTap}
                  className="hover:text-white/80 transition-colors"
                >
                  2024 gamehub
                </button>
                <span className="hidden md:inline">Privacidade</span>
                <span className="hidden md:inline">Termos</span>
              </div>
              <div className="flex gap-6">
                <span className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  Servidores Online
                </span>
                <span>v2.2.0</span>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
