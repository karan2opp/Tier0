import { useState } from "react";
import type { Delivery } from "./hooks/useConversation";
import { CallScreen } from "./components/CallScreen";
import { EndScreen } from "./components/EndScreen";
import { DemoGuide } from "./components/DemoGuide";
import { Lobby } from "./components/Lobby";
import { loadDemoChoice, markGuideSkipped, saveDemoChoice, shouldShowGuide, type DemoChoice } from "./demo";
import { Starfield } from "./components/Starfield";
import { useConversation } from "./hooks/useConversation";
import { unlockSpeech } from "./hooks/useSpeech";
import type { VoiceEngine } from "./hooks/useVoice";

type Screen = "lobby" | "call" | "ended";

const voiceSupported =
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

export default function App() {
  const conversation = useConversation();
  const [screen, setScreen] = useState<Screen>("lobby");
  const [voice, setVoice] = useState(false);
  const [engine, setEngine] = useState<VoiceEngine>("browser");
  const [greeting, setGreeting] = useState<Delivery | null>(null);
  const [callKey, setCallKey] = useState(0);
  const [demo, setDemo] = useState<DemoChoice | null>(loadDemoChoice);
  const [guideOpen, setGuideOpen] = useState(shouldShowGuide);

  const startCall = async (withVoice: boolean, voiceEngine: VoiceEngine = engine) => {
    // Must run inside the click, before any await, or the browser may refuse to speak later.
    if (withVoice) unlockSpeech();
    setVoice(withVoice);
    setEngine(voiceEngine);
    setGreeting(null);
    setCallKey((k) => k + 1);
    setScreen("call");
    setGreeting(await conversation.start());
  };

  return (
    <>
      <Starfield />
      {screen === "lobby" ? (
        <Lobby
          onStart={startCall}
          starting={conversation.busy}
          voiceSupported={voiceSupported}
          demo={demo}
          onOpenGuide={() => setGuideOpen(true)}
        />
      ) : screen === "ended" ? (
        <EndScreen
          state={conversation.state}
          onRestart={() => startCall(voice, engine)}
          onHome={() => {
            conversation.reset();
            setScreen("lobby");
          }}
        />
      ) : (
        <CallScreen
          key={callKey}
          conversation={conversation}
          greeting={greeting}
          voice={voice}
          engine={engine}
          demo={demo}
          onEnd={() => setScreen("ended")}
        />
      )}
      {screen === "lobby" && guideOpen && (
        <DemoGuide
          initial={demo}
          onChoose={(choice) => {
            setDemo(choice);
            saveDemoChoice(choice);
            setGuideOpen(false);
          }}
          onSkip={() => {
            markGuideSkipped();
            setGuideOpen(false);
          }}
        />
      )}
    </>
  );
}
