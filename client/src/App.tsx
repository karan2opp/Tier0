import { useState } from "react";
import type { ConversationReply } from "./api";
import { CallScreen } from "./components/CallScreen";
import { EndScreen } from "./components/EndScreen";
import { Lobby } from "./components/Lobby";
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
  const [greeting, setGreeting] = useState<ConversationReply | null>(null);
  const [callKey, setCallKey] = useState(0);

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

  if (screen === "lobby") {
    return <Lobby onStart={startCall} starting={conversation.busy} voiceSupported={voiceSupported} />;
  }

  if (screen === "ended") {
    return (
      <EndScreen
        state={conversation.state}
        onRestart={() => startCall(voice, engine)}
        onHome={() => {
          conversation.reset();
          setScreen("lobby");
        }}
      />
    );
  }

  return (
    <CallScreen
      key={callKey}
      conversation={conversation}
      greeting={greeting}
      voice={voice}
      engine={engine}
      onEnd={() => setScreen("ended")}
    />
  );
}
