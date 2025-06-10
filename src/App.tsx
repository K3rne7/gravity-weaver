import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
  Auth, 
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  limit,
  onSnapshot,
  serverTimestamp,
  where,
  orderBy,
  doc,
  setDoc,
  Firestore, 
} from 'firebase/firestore';

/****
 * Gravity Weaver - Procedural Levels, Language Toggle, Music Sync
 * Features:
 * ▸ Pulsanti riposizionati per evitare sovrapposizioni
 * ▸ Lingua: italiano / inglese
 * ▸ Input touch/click per invertire gravità
 * ▸ Slider per aumentare velocità della palla
 * ▸ Sync ostacoli a ritmo di musica (ogni traccia utente)
 ****/

/***************
 * CONSTANTS  *
 ***************/
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const BALL_RADIUS = 12;
const BASE_GRAVITY_FORCE = 0.4; 
const MAX_VELOCITY = 8;
const POWERUP_COLLECTION_RADIUS_SQUARED = 900; // (30*30)
const BOUNCE_DAMPING = 0.7;

// Durations (ms)
const SHIELD_DURATION = 5000;
const SLOW_MOTION_DURATION = 3000;
const CONTROLS_HINT_DURATION = 3000;

// Entity types
type GameState = 'menu' | 'playing' | 'gameOver';
type PowerUpType = 'shield' | 'slow' | 'magnet';
type ObstacleType = 'spinner' | 'wave' | 'portal' | 'crusher';

interface Position {
  x: number;
  y: number;
}

interface Velocity {
  x: number;
  y: number;
}

interface Obstacle {
  id: string;
  type: ObstacleType;
  position: Position;
  width: number;
  height: number;
  rotation: number;
  speed: number;
  phase: number;
  color: string;
}

interface PowerUp {
  id: string;
  type: PowerUpType;
  position: Position;
  collected: boolean;
  pulse: number; // For animation
}

interface Particle {
  id: string;
  position: Position;
  velocity: Velocity;
  life: number;
  color: string;
  size: number;
}

interface Star {
  id: string;
  left: number;
  top: number;
  size: number;
  duration: number;
}

/*********************
 * LOCALIZATION TEXT *
 *********************/
const TEXT: Record<'en' | 'it', Record<string, string>> = {
  en: {
    title: 'GRAVITY WEAVER',
    startButton: 'START WEAVING',
    resumeButton: 'RESTART',
    menuInstruction: 'Tap or press SPACE to play!',
    controlGravity: '⭐ Tap / SPACE = Invert gravity',
    powerShield: '🛡️ Shield = Temporary invincibility',
    powerSlow: '⏳ Slow = Slow obstacles',
    powerMagnet: '💰 Magnet = Instant score bonus!',
    scoreLabel: 'Score',
    comboLabel: 'Combo',
    levelLabel: 'Level',
    invulnerableLabel: 'SHIELD ACTIVE!',
    personalBest: 'Best',
    gravityLabel: 'Gravity',
    gameOver: 'GAME OVER',
    yourScore: 'Your Score',
    newPersonalBest: '🏆 NEW PERSONAL BEST! 🏆',
    tiedPersonalBest: '🏆 TIED PERSONAL BEST! 🏆',
    topPlayers: 'Top Weavers',
    languageLabel: 'Language',
    speedLabel: 'Ball Speed',
    musicLabel: 'Game Music',
    uploadMusic: 'Upload Audio (optional)',
    stormEvent: '⚡ STAR STORM ⚡',
    toggleLanguage: 'EN / IT',
    loadingMessage: 'Loading Resources...',
    connectingMessage: 'Connecting to servers...',
    userIdLabel: 'UID',
  },
  it: {
    title: 'GRAVITY WEAVER',
    startButton: 'INIZIA A INTRECCIARE',
    resumeButton: 'INTRECCIA ANCORA',
    menuInstruction: 'Tocca o premi SPAZIO per giocare!',
    controlGravity: '⭐ Tocca / SPAZIO = Inverti gravità',
    powerShield: '🛡️ Scudo = Invincibilità temporanea',
    powerSlow: '⏳ Rallenta = Rallenta ostacoli',
    powerMagnet: '💰 Magnete = Bonus punteggio istantaneo!',
    scoreLabel: 'Punteggio',
    comboLabel: 'Combo',
    levelLabel: 'Livello',
    invulnerableLabel: 'SCUDO ATTIVO!',
    personalBest: 'Migliore',
    gravityLabel: 'Gravità',
    gameOver: 'GAME OVER',
    yourScore: 'Tuo Punteggio',
    newPersonalBest: '🏆 NUOVO MIGLIOR PERSONALE! 🏆',
    tiedPersonalBest: '🏆 PAREGGIATO MIGLIOR PERSONALE! 🏆',
    topPlayers: 'Top Intrecciatori',
    languageLabel: 'Lingua',
    speedLabel: 'Velocità Palla',
    musicLabel: 'Musica di Gioco',
    uploadMusic: 'Carica Audio (facoltativo)',
    stormEvent: '⚡ TEMPESTA STELLARE ⚡',
    toggleLanguage: 'EN / IT',
    loadingMessage: 'Caricamento Risorse...',
    connectingMessage: 'Connessione ai server...',
    userIdLabel: 'UID',
  },
};

/*********************
 * LIVELLI & PATTERNS *
 *********************/
interface LevelConfig {
  thresholdScore: number;
  obstacleBaseChance: number;
  obstacleMax: number;
  allowedObstacleTypes: ObstacleType[];
  obstacleSpeedFactor: number;
  powerUpChance: number;
  eventProbability: number;
}

const LEVELS: LevelConfig[] = [
  { 
    thresholdScore: 0,
    obstacleBaseChance: 0.01,
    obstacleMax: 4,
    allowedObstacleTypes: ['spinner', 'wave'],
    obstacleSpeedFactor: 1,
    powerUpChance: 0.01,
    eventProbability: 0.0005,
  },
  { 
    thresholdScore: 500,
    obstacleBaseChance: 0.015,
    obstacleMax: 5,
    allowedObstacleTypes: ['spinner', 'wave', 'crusher'],
    obstacleSpeedFactor: 1.1,
    powerUpChance: 0.009,
    eventProbability: 0.001,
  },
  { 
    thresholdScore: 1500,
    obstacleBaseChance: 0.02,
    obstacleMax: 6,
    allowedObstacleTypes: ['spinner', 'wave', 'crusher', 'portal'],
    obstacleSpeedFactor: 1.25,
    powerUpChance: 0.008,
    eventProbability: 0.002,
  },
  {
    thresholdScore: 3000,
    obstacleBaseChance: 0.025,
    obstacleMax: 7,
    allowedObstacleTypes: ['spinner', 'wave', 'crusher', 'portal'],
    obstacleSpeedFactor: 1.4,
    powerUpChance: 0.007,
    eventProbability: 0.003,
  },
  {
    thresholdScore: 5000,
    obstacleBaseChance: 0.03,
    obstacleMax: 8,
    allowedObstacleTypes: ['spinner', 'wave', 'crusher', 'portal'],
    obstacleSpeedFactor: 1.6,
    powerUpChance: 0.006,
    eventProbability: 0.005,
  },
];

interface ObstaclePattern {
  offsets: Array<{ dx: number; dy: number; type: ObstacleType }>;
}

const PATTERNS: ObstaclePattern[] = [
  {
    offsets: [
      { dx: 0, dy: 0, type: 'spinner' },
      { dx: -60, dy: -40, type: 'spinner' },
      { dx: 120, dy: 80, type: 'spinner' },
    ],
  },
  {
    offsets: [
      { dx: 0, dy: 0, type: 'wave' },
      { dx: 0, dy: -80, type: 'crusher' },
      { dx: 80, dy: 0, type: 'wave' },
    ],
  },
  {
    offsets: [
      { dx: 0, dy: 0, type: 'portal' },
      { dx: -100, dy: 50, type: 'wave' },
      { dx: 100, dy: -50, type: 'wave' },
    ],
  },
  {
    offsets: [
      { dx: 0, dy: 0, type: 'crusher' },
      { dx: -80, dy: 30, type: 'crusher' },
      { dx: 80, dy: -30, type: 'crusher' },
    ],
  },
];


/****************
 * COMPONENT    *
 ****************/
const App: React.FC = () => {
  /***** GAME STATE *****/
  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(0);
  const [lang, setLang] = useState<'en' | 'it'>('it');
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [db, setDb] = useState<Firestore | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [personalBestScore, setPersonalBestScore] = useState(0);
  const [topGlobalScores, setTopGlobalScores] = useState<
    Array<{ id: string; userId: string; score: number; appContextId?: string }>
  >([]);
  const [ballPos, setBallPos] = useState<Position>({ x: 100, y: CANVAS_HEIGHT / 2 });
  const [ballVel, setBallVel] = useState<Velocity>({ x: 0, y: 0 });
  const [gravityDir, setGravityDir] = useState(1);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [powerUps, setPowerUps] = useState<PowerUp[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [invulnerable, setInvulnerable] = useState(false);
  const [combo, setCombo] = useState(0);
  const [shake, setShake] = useState(0);
  const [showControlsHint, setShowControlsHint] = useState(true);
  const [isEventActive, setIsEventActive] = useState(false);
  const [activeEventType, setActiveEventType] = useState<string | null>(null);
  const lastScoreRef = useRef(score);
  const lastScoreTimeRef = useRef(performance.now());
  const [spawnMultiplier, setSpawnMultiplier] = useState(1);
  const [beatActive, setBeatActive] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const lastBeatRef = useRef<number>(0);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const prevTimeRef = useRef<number | undefined>(undefined);
  const shieldTimeoutRef = useRef<number | undefined>(undefined);
  const slowTimeoutRef = useRef<number | undefined>(undefined);
  const controlsTimeoutRef = useRef<number | undefined>(undefined);
  const gameStateRef = useRef(gameState);
  const ballPosRef = useRef(ballPos);
  const ballVelRef = useRef(ballVel);
  const gravityDirRef = useRef(gravityDir);
  const scoreRef = useRef(score);
  const currentLevelIndexRef = useRef(currentLevelIndex);
  const obstaclesRef = useRef(obstacles);
  const powerUpsRef = useRef(powerUps);
  const invulnerableRef = useRef(invulnerable);
  const isEventActiveRef = useRef(isEventActive);
  const activeEventTypeRef = useRef(activeEventType);
  const speedMultiplierRef = useRef(speedMultiplier);
  const beatActiveRef = useRef(beatActive);
  const spawnMultiplierRef = useRef(spawnMultiplier);

    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
    useEffect(() => { ballPosRef.current = ballPos; }, [ballPos]);
    useEffect(() => { ballVelRef.current = ballVel; }, [ballVel]);
    useEffect(() => { gravityDirRef.current = gravityDir; }, [gravityDir]);
    useEffect(() => { scoreRef.current = score; }, [score]);
    useEffect(() => { currentLevelIndexRef.current = currentLevelIndex; }, [currentLevelIndex]);
    useEffect(() => { obstaclesRef.current = obstacles; }, [obstacles]);
    useEffect(() => { powerUpsRef.current = powerUps; }, [powerUps]);
    useEffect(() => { invulnerableRef.current = invulnerable; }, [invulnerable]);
    useEffect(() => { isEventActiveRef.current = isEventActive; }, [isEventActive]);
    useEffect(() => { activeEventTypeRef.current = activeEventType; }, [activeEventType]);
    useEffect(() => { speedMultiplierRef.current = speedMultiplier; }, [speedMultiplier]);
    useEffect(() => { beatActiveRef.current = beatActive; }, [beatActive]);
    useEffect(() => { spawnMultiplierRef.current = spawnMultiplier; }, [spawnMultiplier]);

  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: 50 }).map((_, i) => ({
      id: `star-${i}-${Math.random().toString(36).substring(2, 9)}`,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      duration: Math.random() * 4 + 3,
    }));
  }, []);

  const generateObstaclePattern = useCallback((): Obstacle[] => {
    const levelConfig = LEVELS[currentLevelIndexRef.current];
    const patternIndex = Math.floor(Math.random() * PATTERNS.length);
    const pattern = PATTERNS[patternIndex];

    return pattern.offsets.map((offset) => {
      const type = levelConfig.allowedObstacleTypes.includes(offset.type)
        ? offset.type
        : levelConfig.allowedObstacleTypes[0];
      const isPortal = type === 'portal';
      const baseSpeed = 2.5;
      const speed =
        (baseSpeed + Math.random() * 2 + scoreRef.current / 5000) * levelConfig.obstacleSpeedFactor *
        (isEventActiveRef.current && activeEventTypeRef.current === 'storm' ? 1.2 : 1) * (beatActiveRef.current ? 1.3 : 1); 

      return {
        id: `obs-${Math.random().toString(36).substring(2, 9)}`,
        type,
        position: {
          x: CANVAS_WIDTH + 60 + offset.dx,
          y: Math.min(
            Math.max(offset.dy + CANVAS_HEIGHT / 2, 50), 
            CANVAS_HEIGHT - 50
          ),
        },
        width: isPortal ? 50 : type === 'crusher' ? 30 : 40,
        height: isPortal ? 50 : type === 'crusher' ? 180 : 70,
        rotation: 0,
        speed,
        phase: Math.random() * Math.PI * 2,
        color: `hsl(${Math.floor(Math.random() * 360)}, 75%, 65%)`,
      };
    });
  }, []); 

  const generateObstacle = useCallback((): Obstacle => {
    const levelConfig = LEVELS[currentLevelIndexRef.current]; 
    const types = levelConfig.allowedObstacleTypes;
    const type = types[Math.floor(Math.random() * types.length)];
    const isPortal = type === 'portal';

    const baseSpeed = 2.5;
    const speed =
      (baseSpeed + Math.random() * 2 + scoreRef.current / 5000) * levelConfig.obstacleSpeedFactor *
      (isEventActiveRef.current && activeEventTypeRef.current === 'storm' ? 1.2 : 1) * (beatActiveRef.current ? 1.3 : 1); 

    return {
      id: `obs-${Math.random().toString(36).substring(2, 9)}`,
      type,
      position: {
        x: CANVAS_WIDTH + 60, 
        y: Math.random() * (CANVAS_HEIGHT - 250) + 125, 
      },
      width: isPortal ? 50 : type === 'crusher' ? 30 : 40,
      height: isPortal ? 50 : type === 'crusher' ? 180 : 70,
      rotation: 0,
      speed,
      phase: Math.random() * Math.PI * 2,
      color: `hsl(${Math.floor(Math.random() * 360)}, 75%, 65%)`,
    };
  }, []); 

  const generatePowerUp = useCallback((): PowerUp => {
    const types: PowerUpType[] = ['shield', 'slow', 'magnet'];
    const type = types[Math.floor(Math.random() * types.length)];

    return {
      id: `pow-${Math.random().toString(36).substring(2, 9)}`,
      type,
      position: {
        x: CANVAS_WIDTH + 40,
        y: Math.random() * (CANVAS_HEIGHT - 150) + 75,
      },
      collected: false,
      pulse: 0,
    };
  }, []);

  const createParticles = useCallback(
    (
      position: Position,
      count = 10,
      color = '#FFD700', 
      gravityEffect = false 
    ) => {
      const newParticles = Array.from({ length: count }).map(() => ({
        id: `part-${Math.random().toString(36).substring(2, 9)}`,
        position: { 
          x: position.x + (Math.random() - 0.5) * 15,
          y: position.y + (Math.random() - 0.5) * 15,
        },
        velocity: {
          x: (Math.random() - 0.5) * 7, 
          y: (Math.random() - 0.5) * 7 - (gravityEffect ? 2 : 0), 
        },
        life: 1, 
        color,
        size: Math.random() * 3.5 + 1.5,
      }));

      setParticles((prev) => [...prev, ...newParticles].slice(-100)); 
    },
    [] 
  );

  const toggleGravity = useCallback(() => {
    if (gameStateRef.current !== 'playing') {
        return;
    }
    setGravityDir((d) => -d);
    createParticles(ballPosRef.current, 8, gravityDirRef.current === 1 ? '#FFB6C1' : '#87CEFA');
    setShake(6);

    if (navigator.vibrate) navigator.vibrate(50);
  }, [createParticles]); 

  const startGame = useCallback(() => {
    if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
    if (slowTimeoutRef.current) clearTimeout(slowTimeoutRef.current);

    setGameState('playing');
    setScore(0);
    setCombo(0);
    setBallPos({ x: 100, y: CANVAS_HEIGHT / 2 });
    setBallVel({ x: 0, y: 0 });
    setGravityDir(1);
    setObstacles([generateObstacle()]); 
    setPowerUps([]);
    setParticles([]);
    setInvulnerable(false);
    setShake(0);
    setCurrentLevelIndex(0);
    setIsEventActive(false);
    setActiveEventType(null);
    setSpawnMultiplier(1);

    setBeatActive(false);
    lastBeatRef.current = 0;

    setShowControlsHint(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      setShowControlsHint(false);
    }, CONTROLS_HINT_DURATION);

    if (audioElementRef.current) {
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.play().catch((err) => {
        console.warn("Audio play failed (user interaction might be needed):", err);
      });
      if (!audioContextRef.current) {
        const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextConstructor && audioElementRef.current) {
          try {
            const ctx = new AudioContextConstructor();
            audioContextRef.current = ctx;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048; 
            analyserRef.current = analyser;
            if (audioSourceRef.current) {
                audioSourceRef.current.disconnect();
            }
            const source = ctx.createMediaElementSource(audioElementRef.current);
            audioSourceRef.current = source;
            source.connect(analyser);
            analyser.connect(ctx.destination); 
            dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
          } catch (e) {
            console.error("Error setting up AudioContext: ", e);
             audioContextRef.current = null; 
          }
        }
      } else {
        audioContextRef.current.resume().catch(() => {});
      }
    }
  }, [generateObstacle]); 

  const handleGameAction = useCallback(() => {
    if (gameStateRef.current === 'menu' || gameStateRef.current === 'gameOver') {
      startGame();
    } else if (gameStateRef.current === 'playing') {
      toggleGravity();
    }
  }, [startGame, toggleGravity]); 


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleGameAction();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleGameAction]); 

  useEffect(() => {
    try {
      const firebaseConfigString = (window as any).__firebase_config;
      if (!firebaseConfigString || firebaseConfigString === "{}") {
        console.warn('Firebase config missing or empty. Global scores will not function.');
        setIsAuthReady(true); 
        return;
      }
      const firebaseConfig = JSON.parse(firebaseConfigString);
      if (Object.keys(firebaseConfig).length === 0) {
         console.warn('Parsed Firebase config is empty. Global scores will not function.');
         setIsAuthReady(true);
         return;
      }

      const appInstance = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(appInstance);
      const firebaseAuth = getAuth(appInstance);

      setDb(firestoreDb); 
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          const initialAuthToken = (window as any).__initial_auth_token;
          try {
            if (initialAuthToken && initialAuthToken !== "undefined") { 
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (error) {
            console.error('Firebase sign-in error, attempting anonymous fallback:', error);
            if (!firebaseAuth.currentUser) {
                 try { await signInAnonymously(firebaseAuth); }
                 catch (anonError) { console.error('Firebase anonymous sign-in fallback failed:', anonError); }
            }
          }
        }
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (error) {
      console.error('Critical error initializing Firebase:', error);
      setIsAuthReady(true); 
    }
  }, []);

  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;

    const appId = (window as any).__app_id || 'default-gravity-weaver';
    const scoresCollectionPath = `artifacts/${appId}/public/data/gravityWeaverScores`;
    const scoresCol = collection(db, scoresCollectionPath);

    const personalQuery = query(scoresCol, where('userId', '==', userId));
    const unsubPersonal = onSnapshot(
      personalQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const userScores = snapshot.docs.map((d) => d.data().score as number);
          userScores.sort((a, b) => b - a); 
          setPersonalBestScore(userScores[0] || 0);
        } else {
          setPersonalBestScore(0); 
        }
      },
      (error) => {
        console.error('Error fetching personal best:', error);
      }
    );

    const globalQuery = query(scoresCol, orderBy('score', 'desc'), limit(5));
    const unsubGlobal = onSnapshot(
      globalQuery,
      (snapshot) => {
        const scoresData = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as { userId: string; score: number; appContextId?: string }), 
        }));
        setTopGlobalScores(scoresData);
      },
      (error) => {
        console.error('Error fetching global scores:', error);
      }
    );

    return () => {
      unsubPersonal();
      unsubGlobal();
    };
  }, [db, userId, isAuthReady]); 

  const triggerRandomEvent = useCallback(() => {
    if (isEventActiveRef.current) return; 

    const levelConfig = LEVELS[currentLevelIndexRef.current];
    const possibleEvents = ['storm', 'fog', 'invertShock']; 
    const chosen = possibleEvents[Math.floor(Math.random() * possibleEvents.length)];
    
    setActiveEventType(chosen);
    setIsEventActive(true);

    if (chosen === 'invertShock') {
        // Example: setGravityDir(d => -d); 
    }

    setTimeout(() => {
      setIsEventActive(false);
      setActiveEventType(null);
    }, 4000); 
  }, []); 

  const checkObstacleCollisions = useCallback(
    (ballCurrentPos: Position): boolean => {
      for (const obs of obstaclesRef.current) { 
        const halfW = obs.width / 2;
        const halfH = obs.height / 2;
        const obsLeft = obs.position.x - halfW;
        const obsRight = obs.position.x + halfW;
        const obsTop = obs.position.y - halfH;
        const obsBottom = obs.position.y + halfH;

        if (
          ballCurrentPos.x + BALL_RADIUS < obsLeft ||
          ballCurrentPos.x - BALL_RADIUS > obsRight ||
          ballCurrentPos.y + BALL_RADIUS < obsTop ||
          ballCurrentPos.y - BALL_RADIUS > obsBottom
        ) {
          continue; 
        }

        const closestX = Math.max(obsLeft, Math.min(ballCurrentPos.x, obsRight));
        const closestY = Math.max(obsTop, Math.min(ballCurrentPos.y, obsBottom));

        const dx = ballCurrentPos.x - closestX;
        const dy = ballCurrentPos.y - closestY;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < BALL_RADIUS * BALL_RADIUS && !invulnerableRef.current) { 
          return true; 
        }
      }
      return false; 
    },
    [] 
  );

  const collectPowerUps = useCallback(() => {
    setPowerUps((prevPowerUps) => {
      const newPowerUps = [...prevPowerUps];
      let changed = false;
      for (let i = newPowerUps.length - 1; i >= 0; i--) {
        const p = newPowerUps[i];
        if (p.collected) continue;

        const dx = ballPosRef.current.x - p.position.x; 
        const dy = ballPosRef.current.y - p.position.y; 
        const distanceSquared = dx * dx + dy * dy;

        // <<< ERRORE DI BATTITURA CORRETTO QUI >>>
        if (distanceSquared < POWERUP_COLLECTION_RADIUS_SQUARED) {
          newPowerUps[i] = { ...p, collected: true };
          changed = true;
          createParticles(p.position, 15, '#32CD32'); 

          switch (p.type) {
            case 'shield':
              setInvulnerable(true);
              if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
              shieldTimeoutRef.current = window.setTimeout(() => {
                setInvulnerable(false);
              }, SHIELD_DURATION);
              break;
            case 'slow':
              setObstacles((obs) =>
                obs.map((o) => ({ ...o, speed: o.speed * 0.6 }))
              );
              if (slowTimeoutRef.current) clearTimeout(slowTimeoutRef.current);
              slowTimeoutRef.current = window.setTimeout(() => {
                setObstacles((obs) => 
                  obs.map((o) => ({ ...o, speed: o.speed / 0.6 }))
                );
              }, SLOW_MOTION_DURATION);
              break;
            case 'magnet':
              setScore((s) => s + 500); 
              setCombo((c) => c + 5); 
              break;
          }
        }
      }
      return changed
        ? newPowerUps.filter((p) => !p.collected || p.position.x > -50) 
        : prevPowerUps;
    });
  }, [createParticles]); 

  useEffect(() => {
    const now = performance.now();
    const elapsed = (now - lastScoreTimeRef.current) / 1000; 
    
    if (elapsed >= 2) { 
      const gained = score - lastScoreRef.current; 
      const pps = gained / elapsed;

      if (pps > 15) { 
        setSpawnMultiplier((m) => Math.min(1.5, m + 0.05)); 
      } else if (pps < 5) { 
        setSpawnMultiplier((m) => Math.max(0.8, m - 0.05));
      }

      lastScoreRef.current = score;
      lastScoreTimeRef.current = now;
    }
  }, [score]); 

  useEffect(() => {
    const nextLevelIndex = currentLevelIndex + 1; 
    if (
      nextLevelIndex < LEVELS.length &&
      score >= LEVELS[nextLevelIndex].thresholdScore 
    ) {
      setCurrentLevelIndex(nextLevelIndex);
      createParticles( 
        { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
        30,
        '#FFD700' 
      );
    }
  }, [score, currentLevelIndex, createParticles]);

  const detectBeat = useCallback(() => {
    if (
      analyserRef.current &&
      dataArrayRef.current &&
      audioContextRef.current &&
      audioElementRef.current && !audioElementRef.current.paused 
    ) {
      analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
      let sumSquares = 0;
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        const normalized = (dataArrayRef.current[i] - 128) / 128; 
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArrayRef.current.length); 
      const threshold = 0.3; 
      const now = audioContextRef.current.currentTime;
      
      if (
        rms > threshold &&
        lastBeatRef.current + 0.3 < now 
      ) {
        lastBeatRef.current = now;
        setBeatActive(true);
        setTimeout(() => setBeatActive(false), 100); 
      }
    }
  }, []); 

  const gameLoop = useCallback(
    (timestamp: number) => {
      if (gameStateRef.current !== 'playing') { 
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        requestRef.current = requestAnimationFrame(gameLoop); 
        return;
      }

      const timeDelta = prevTimeRef.current ? timestamp - prevTimeRef.current : 16.66;
      const effectiveDeltaRatio = Math.min(2, Math.max(0.1, timeDelta / 16.66)); 
      prevTimeRef.current = timestamp;

      detectBeat();

      let currentVelY = ballVelRef.current.y;
      let currentPosX = ballPosRef.current.x;
      let currentPosY = ballPosRef.current.y;

      const gravityForce = BASE_GRAVITY_FORCE * speedMultiplierRef.current; 
      let newTentativeVelY = currentVelY + gravityForce * gravityDirRef.current * effectiveDeltaRatio; 
      newTentativeVelY = Math.max(
        -MAX_VELOCITY * speedMultiplierRef.current, 
        Math.min(MAX_VELOCITY * speedMultiplierRef.current, newTentativeVelY) 
      );

      let newTentativePosY = currentPosY + newTentativeVelY * effectiveDeltaRatio;

      if (newTentativePosY - BALL_RADIUS <= 0 && newTentativeVelY < 0) {
        newTentativePosY = BALL_RADIUS;
        newTentativeVelY = -newTentativeVelY * BOUNCE_DAMPING;
        setGravityDir((prevDir) => -prevDir);
        createParticles({ x: currentPosX, y: BALL_RADIUS }, 12, '#88FFFF');
        setShake(5);
        if (navigator.vibrate) navigator.vibrate(40);
      } else if (newTentativePosY + BALL_RADIUS >= CANVAS_HEIGHT && newTentativeVelY > 0) {
        newTentativePosY = CANVAS_HEIGHT - BALL_RADIUS;
        newTentativeVelY = -newTentativeVelY * BOUNCE_DAMPING;
        setGravityDir((prevDir) => -prevDir);
        createParticles({ x: currentPosX, y: CANVAS_HEIGHT - BALL_RADIUS }, 12, '#FF88FF');
        setShake(5);
        if (navigator.vibrate) navigator.vibrate(40);
      }

      setBallVel({ x: 0, y: newTentativeVelY });
      setBallPos({ x: currentPosX, y: newTentativePosY });
      
      const collisionCheckPos = { x: currentPosX, y: newTentativePosY };

      if (
        !isEventActiveRef.current && 
        Math.random() < LEVELS[currentLevelIndexRef.current].eventProbability * effectiveDeltaRatio 
      ) {
        triggerRandomEvent();
      }

      setObstacles((prevObs) =>
        prevObs
          .map((obs) => {
            const updated = { ...obs };
            const speedMultiplierEvent = isEventActiveRef.current && activeEventTypeRef.current === 'storm' ? 1.2 : 1; 
            const speedMultiplierBeat = beatActiveRef.current ? 1.3 : 1; 
            updated.position.x -= updated.speed * speedMultiplierEvent * speedMultiplierBeat * effectiveDeltaRatio;
            updated.phase += 0.05 * effectiveDeltaRatio * (updated.type === 'crusher' ? 2 : 1);

            switch (updated.type) {
              case 'spinner': updated.rotation += 4 * effectiveDeltaRatio * (updated.speed / 3); break;
              case 'wave': updated.position.y += Math.sin(updated.phase) * 1.5 * effectiveDeltaRatio; break;
              case 'portal': updated.rotation -= 2.5 * effectiveDeltaRatio; break;
              case 'crusher': updated.height = 150 + Math.abs(Math.sin(updated.phase)) * 100; break;
            }
            return updated;
          })
          .filter((obs) => obs.position.x > -150) 
      );

      setPowerUps((prevPows) =>
        prevPows
          .map((p) => ({
            ...p,
            position: { ...p.position, x: p.position.x - 2.5 * effectiveDeltaRatio },
            pulse: p.pulse + 0.15 * effectiveDeltaRatio,
          }))
          .filter((p) => p.position.x > -80 || p.collected)
          .filter((p) => !p.collected || p.pulse < Math.PI * 4) 
      );

      setParticles((prevParts) =>
        prevParts
          .map((p) => ({
            ...p,
            position: {
              x: p.position.x + p.velocity.x * effectiveDeltaRatio,
              y: p.position.y + p.velocity.y * effectiveDeltaRatio,
            },
            velocity: { ...p.velocity, y: p.velocity.y + 0.1 * effectiveDeltaRatio }, 
            life: p.life - 0.02 * effectiveDeltaRatio,
          }))
          .filter((p) => p.life > 0)
      );

      const levelConfig = LEVELS[currentLevelIndexRef.current]; 
      const dynamicObstacleChance = levelConfig.obstacleBaseChance * spawnMultiplierRef.current + scoreRef.current * 0.00001; 

      if (
        Math.random() < dynamicObstacleChance * effectiveDeltaRatio &&
        obstaclesRef.current.length < levelConfig.obstacleMax 
      ) {
        if (Math.random() < 0.25) { 
          setObstacles((prev) => [...prev, ...generateObstaclePattern()]);
        } else {
          setObstacles((prev) => [...prev, generateObstacle()]);
        }
      }

      if (
        Math.random() < levelConfig.powerUpChance * effectiveDeltaRatio &&
        powerUpsRef.current.filter((p) => !p.collected).length < 2 
      ) {
        setPowerUps((prev) => [...prev, generatePowerUp()]);
      }

      setScore((s) => s + Math.round(1 * effectiveDeltaRatio));
      setCombo((c) => c + Math.round(1 * effectiveDeltaRatio));

      setShake((s) => Math.max(0, s - 0.5 * effectiveDeltaRatio));

      const collidedWithObstacle = checkObstacleCollisions(collisionCheckPos);

      if (collidedWithObstacle) {
        setGameState('gameOver');
        createParticles(ballPosRef.current, 30, '#FF4500', true); 
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        if (db && userId && isAuthReady && scoreRef.current + 1 > 0) { 
          const appId = (window as any).__app_id || 'default-gravity-weaver';
          const scoresCollectionPath = `artifacts/${appId}/public/data/gravityWeaverScores`;
          try {
            addDoc(collection(db, scoresCollectionPath), {
              userId: userId,
              score: scoreRef.current + 1, 
              createdAt: serverTimestamp(),
              appContextId: appId,
              maxLevelReached: currentLevelIndexRef.current + 1, 
            });
          } catch (error) {
            console.error('Error adding score to Firestore:', error);
          }
        }
      }

      collectPowerUps();

      requestRef.current = requestAnimationFrame(gameLoop);
    },
    [ 
      db, userId, isAuthReady, collectPowerUps, createParticles, 
      checkObstacleCollisions, detectBeat, generateObstacle, generateObstaclePattern, 
      generatePowerUp, setBallPos, setBallVel, setCombo, setGameState, 
      setGravityDir, setObstacles, setParticles, setPowerUps, setScore, 
      setShake, triggerRandomEvent 
    ]
  );

  useEffect(() => {
    if (gameState === 'playing') { 
      prevTimeRef.current = performance.now();
      requestRef.current = requestAnimationFrame(gameLoop);
    } else {
      if (requestRef.current) { 
        cancelAnimationFrame(requestRef.current);
      }
    }
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [gameState, gameLoop]); 

  useEffect(() => {
    return () => {
      if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
      if (slowTimeoutRef.current) clearTimeout(slowTimeoutRef.current);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(e => console.warn("Error closing AudioContext", e));
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = ""; 
      }
       if (audioSourceRef.current) {
        audioSourceRef.current.disconnect(); 
      }
    };
  }, []); 

  const renderGameArea = () => (
    <div
      className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 shadow-2xl rounded-lg cursor-pointer game-area-interaction" 
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        transform: `translateX(${Math.random() * shake - shake / 2}px) translateY(${
          Math.random() * shake - shake / 2
        }px)`,
      }}
      onTouchStart={(e) => {
        e.preventDefault(); 
        setTimeout(() => {
            handleGameAction();
        }, 0);
      }}
      onClick={() => { 
        handleGameAction();
      }}
    >
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full bg-slate-300"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            animation: `twinkle ${star.duration}s infinite ease-in-out`,
          }}
        />
      ))}

      {isEventActive && activeEventType === 'fog' && (
        <div
          className="absolute inset-0 bg-gray-900 opacity-50 z-40 pointer-events-none animate-pulse"
        />
      )}

      {isEventActive && activeEventType === 'storm' && (
        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-yellow-300 text-xl z-50 font-bold select-none animate-ping">
          {TEXT[lang].stormEvent}
        </div>
      )}

      <div
        className={`absolute rounded-full ${
          invulnerable ? 'animate-pulse' : ''
        }`}
        style={{
          left: ballPos.x - BALL_RADIUS, 
          top: ballPos.y - BALL_RADIUS,   
          width: BALL_RADIUS * 2,
          height: BALL_RADIUS * 2,
          background: invulnerable
            ? 'radial-gradient(circle, #FFFACD, #FFD700)'
            : gravityDir === 1
            ? 'radial-gradient(circle, #ADD8E6, #87CEEB)'
            : 'radial-gradient(circle, #FFC0CB, #FFB6C1)',
          boxShadow: `0 0 18px ${
            invulnerable
              ? '#FFD700'
              : gravityDir === 1
              ? '#87CEEB'
              : '#FFB6C1'
          }`,
          filter: 'brightness(1.1)',
          transition: 'background 0.3s ease-out',
          zIndex: 20,
        }}
      />

      {obstacles.map((obs) => ( 
        <div
          key={obs.id}
          className="absolute"
          style={{
            left: obs.position.x - obs.width / 2,
            top: obs.position.y - obs.height / 2,
            width: obs.width,
            height: obs.height,
            background: obs.color,
            transform: `rotate(${obs.rotation}deg)`,
            // <<< ERRORE DI SINTASSI CORRETTO QUI >>>
            borderRadius: obs.type === 'portal' ? '50%' : '6px',
            boxShadow: `0 0 12px ${obs.color}aa`,
            opacity: obs.type === 'portal' ? 0.75 : 0.95,
            zIndex: 10,
          }}
        />
      ))}

      {powerUps 
        .filter((p) => !p.collected || p.pulse < Math.PI * 2) 
        .map((p) => (
          <div
            key={p.id}
            className="absolute flex items-center justify-center text-white font-bold rounded-full text-lg" 
            style={{
              left: p.position.x - 15,
              top: p.position.y - 15,
              width: 30,
              height: 30,
              background: 'radial-gradient(circle, #90EE90, #32CD32)',
              transform: `scale(${1 + Math.sin(p.pulse) * 0.15}) rotate(${
                p.pulse * 20
              }deg)`,
              boxShadow: '0 0 12px #32CD32',
              opacity: p.collected ? Math.max(0, 1 - (p.pulse / (Math.PI *2))) : 1, 
              transition: 'opacity 0.3s',
              zIndex: 15,
            }}
          >
            {p.type === 'shield' ? '🛡️' : p.type === 'slow' ? '⏳' : '💰'}
          </div >
        ))}

      {particles.map((pt) => ( 
        <div
          key={pt.id}
          className="absolute rounded-sm" 
          style={{
            left: pt.position.x - pt.size / 2,
            top: pt.position.y - pt.size / 2,
            width: pt.size,
            height: pt.size,
            background: pt.color,
            opacity: pt.life * 0.8, 
            boxShadow: `0 0 6px ${pt.color}88`,
            zIndex: 5,
            borderRadius: '50%' 
          }}
        />
      ))}

      <div className="absolute top-3 left-3 text-white font-semibold z-30 p-2 bg-black/40 rounded-md shadow-lg">
        <div className="text-xl drop-shadow-md">
          {TEXT[lang].scoreLabel}: {score}
        </div>
        <div className="text-xs opacity-80">
          {TEXT[lang].comboLabel}: {combo}
        </div>
        <div className="text-sm opacity-80">
          {TEXT[lang].levelLabel}: {currentLevelIndex + 1}
        </div>
        {invulnerable && (
          <div className="text-yellow-300 animate-pulse text-sm select-none mt-1">
            {TEXT[lang].invulnerableLabel}
          </div>
        )}
      </div>

      <div className="absolute top-3 right-3 text-white text-right z-30 p-2 bg-black/40 rounded-md shadow-lg">
        <div className="text-sm drop-shadow-md">
          {TEXT[lang].personalBest}: {personalBestScore}
        </div>
        <div className="text-xs opacity-80 select-none">
          {TEXT[lang].gravityLabel}: {gravityDir === 1 ? '▼' : '▲'}
        </div>
      </div>

      {showControlsHint && gameState === 'playing' && (
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 text-center text-white opacity-80 animate-pulse z-30 text-sm p-2 bg-black/50 rounded-lg shadow-md mx-auto w-3/4 select-none">
          {TEXT[lang].controlGravity}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-2 sm:p-4 select-none font-['Inter',_sans-serif]">
      <style>
        {`
          @keyframes twinkle {
            0%, 100% { opacity: 0.2; transform: scale(0.95); }
            30%, 70% { opacity: 0.8; transform: scale(1.05); } 
          }
          body { margin: 0; font-family: 'Inter', sans-serif; overflow: hidden; }
          
          .game-area-interaction {
            -webkit-user-select: none; 
            -moz-user-select: none;    
            -ms-user-select: none;     
            user-select: none;         
            -webkit-touch-callout: none; 
            touch-action: manipulation; 
          }

          .leaderboard-scroll::-webkit-scrollbar {
            width: 8px;
          }
          .leaderboard-scroll::-webkit-scrollbar-thumb {
            background-color: #4A5568; 
            border-radius: 4px;
          }
          .leaderboard-scroll::-webkit-scrollbar-track {
            background-color: #2D3748; 
          }
        `}
      </style>

      <div className="absolute top-2 left-2 z-50">
        <button
          onClick={() => setLang((l) => (l === 'it' ? 'en' : 'it'))}
          className="px-3 py-1.5 bg-gray-800/70 text-sm rounded-md hover:bg-gray-700 transition-colors shadow-md"
        >
          {TEXT[lang].toggleLanguage}
        </button>
      </div>

      {gameState === 'menu' && (
        <div className="absolute top-2 right-2 z-50 w-40 sm:w-48 p-2 bg-black/50 rounded-md shadow-md">
          <label htmlFor="speedSlider" className="text-xs sm:text-sm text-white mb-1 block">
            {TEXT[lang].speedLabel}: <span className="font-semibold">{speedMultiplier.toFixed(2)}x</span>
          </label>
          <input
            id="speedSlider"
            type="range"
            min="0.8"
            max="1.5"
            step="0.01"
            value={speedMultiplier}
            onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
            className="w-full mt-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
          />
        </div>
      )}

      {userId && (
        <div className="absolute bottom-1 right-1 text-[10px] sm:text-xs text-slate-600 p-1 z-50 select-all bg-slate-800/30 rounded">
          {TEXT[lang].userIdLabel}: {userId} 
        </div>
      )}

      {(!isAuthReady || (Object.keys((window as any).__firebase_config || {}).length > 0 && !db)) && (
        <div className="text-center p-10">
          <div className="text-2xl font-semibold animate-pulse">
            {TEXT[lang].loadingMessage}
          </div>
          <p className="text-slate-400 mt-2">{TEXT[lang].connectingMessage}</p>
        </div>
      )}

      {isAuthReady && (db || Object.keys((window as any).__firebase_config || {}).length === 0) && gameState === 'menu' && (
        <div className="text-center text-slate-100 max-w-md sm:max-w-lg p-4 sm:p-6 space-y-4 sm:space-y-6 bg-slate-900/70 rounded-xl shadow-2xl">
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-2 bg-gradient-to-r from-sky-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent select-none">
            {TEXT[lang].title}
          </h1>
          <p className="text-md sm:text-lg text-slate-300 select-none">
            {TEXT[lang].menuInstruction}
          </p>

          <div className="p-3 sm:p-4 bg-slate-800/60 rounded-lg shadow-md space-y-1.5 text-left">
            <p className="text-sm sm:text-base text-slate-300">{TEXT[lang].controlGravity}</p>
            <p className="text-sm sm:text-base text-slate-300">{TEXT[lang].powerShield}</p>
            <p className="text-sm sm:text-base text-slate-300">{TEXT[lang].powerSlow}</p>
            <p className="text-sm sm:text-base text-slate-300">{TEXT[lang].powerMagnet}</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="audioUpload" className="text-sm text-slate-300 select-none block text-left">
                {TEXT[lang].uploadMusic}:
            </label>
            <input
              id="audioUpload"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const url = URL.createObjectURL(file);
                  if (!audioElementRef.current) {
                    const audioEl = new Audio(url);
                    audioEl.loop = true;
                    audioElementRef.current = audioEl;
                  } else {
                    audioElementRef.current.src = url;
                  }
                  if (audioSourceRef.current) {
                    audioSourceRef.current.disconnect();
                    audioSourceRef.current = null;
                  }
                  if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                     audioContextRef.current.close().then(() => {
                        audioContextRef.current = null;
                     }).catch(err => console.warn("Error closing audio context for new file", err));
                  } else {
                     audioContextRef.current = null;
                  }
                }
              }}
              className="w-full text-xs sm:text-sm text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-sky-600 file:text-sky-50 hover:file:bg-sky-500 bg-slate-800/70 rounded-md p-1.5 cursor-pointer"
            />
          </div>

          <button
            onClick={handleGameAction}
            className="w-full sm:w-auto px-8 py-3 bg-gradient-to-br from-sky-500 to-cyan-500 rounded-full text-lg sm:text-xl font-bold hover:from-sky-400 hover:to-cyan-400 active:scale-95 transition-all duration-200 ease-in-out shadow-xl hover:shadow-sky-400/40 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-75 select-none"
          >
            {TEXT[lang].startButton}
          </button>

          {personalBestScore > 0 && (
            <p className="mt-2 text-yellow-400 text-md sm:text-lg select-none">
              {TEXT[lang].personalBest}: {personalBestScore}
            </p>
          )}
          {topGlobalScores.length > 0 && (
            <div className="mt-2 sm:mt-3 text-left">
              <h3 className="text-md sm:text-lg font-semibold text-teal-300 mb-1.5 select-none">
                {TEXT[lang].topPlayers}:
              </h3>
              <ul className="text-xs sm:text-sm text-slate-400 bg-slate-800/50 p-2 sm:p-3 rounded-md max-h-28 sm:max-h-32 overflow-y-auto leaderboard-scroll space-y-0.5">
                {topGlobalScores.map((s) => (
                  <li key={s.id} className="flex justify-between select-none even:bg-slate-700/30 px-1 py-0.5 rounded-sm">
                    <span className={s.userId === userId ? 'text-yellow-400 font-bold' : ''}>
                        {s.userId === userId ? 'You' : `Player-${s.userId.substring(0, 4)}..`}
                    </span>
                    <span className="font-medium">{s.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isAuthReady && (db || Object.keys((window as any).__firebase_config || {}).length === 0) && gameState === 'playing' && (
        <div className="rounded-lg shadow-2xl shadow-purple-500/40">
          {renderGameArea()}
        </div>
      )}

      {isAuthReady && (db || Object.keys((window as any).__firebase_config || {}).length === 0) && gameState === 'gameOver' && (
        <div className="text-center text-slate-100 max-w-md sm:max-w-lg p-4 sm:p-6 space-y-4 sm:space-y-6 bg-slate-900/70 rounded-xl shadow-2xl">
          <h2 className="text-4xl sm:text-5xl font-bold mb-1 text-red-500 select-none">
            {TEXT[lang].gameOver}
          </h2>
          <div className="text-xl sm:text-2xl mb-1 select-none">
            {TEXT[lang].yourScore}: {score}
          </div>
          <div className="text-lg sm:text-xl mb-1 text-yellow-400 select-none">
            {TEXT[lang].personalBest}: {personalBestScore}
          </div>

          {score > 0 && score >= personalBestScore && (
            <div className="text-yellow-300 mb-2 animate-bounce text-xl sm:text-2xl select-none">
              {score === personalBestScore && personalBestScore > 0 && score > 0 
                ? TEXT[lang].tiedPersonalBest
                : TEXT[lang].newPersonalBest}
            </div>
          )}

          <button
            onClick={handleGameAction}
            className="w-full sm:w-auto px-8 py-3 bg-gradient-to-br from-sky-500 to-cyan-500 rounded-full text-lg sm:text-xl font-bold hover:from-sky-400 hover:to-cyan-400 active:scale-95 transition-all duration-200 ease-in-out shadow-xl hover:shadow-sky-400/40 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-opacity-75 select-none"
          >
            {TEXT[lang].resumeButton}
          </button>

          {topGlobalScores.length > 0 && (
            <div className="mt-2 sm:mt-3 text-left">
              <h3 className="text-md sm:text-lg font-semibold text-teal-300 mb-1.5 select-none">
                {TEXT[lang].topPlayers}:
              </h3>
              <ul className="text-xs sm:text-sm text-slate-400 bg-slate-800/50 p-2 sm:p-3 rounded-md max-h-28 sm:max-h-32 overflow-y-auto leaderboard-scroll space-y-0.5">
                {topGlobalScores.map((s) => (
                  <li
                    key={s.id}
                    className={`flex justify-between select-none even:bg-slate-700/30 px-1 py-0.5 rounded-sm ${
                      s.userId === userId && s.score === score
                        ? 'text-yellow-400 font-bold ring-1 ring-yellow-500/50' 
                        : ''
                    }`}
                  >
                    <span>
                      {s.userId === userId
                        ? 'You'
                        : `Player-${s.userId.substring(0, 4)}..`}
                    </span>
                    <span className="font-medium">{s.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;