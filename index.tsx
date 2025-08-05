/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

const categoryMap: { [key: string]: string } = {
  lustig: 'lustiges',
  mathematisch: 'mathematisches(bei falsch soll die Antwort begründet sein)',
  detektiv: 'Detektiv (man kann aus zwei oder drei Alternativen auswählen. Die Antwort soll zeigen warum es richtig oder falsch ist)',
  mysteriös: 'seltsam verrücktes (aber mit Hinweisen, man kann es fast herauslesen was die Antwort ist)',
  minecraft: 'über Minecraft',
};
const categoryLabels: { [key: string]: string } = {
  lustig: 'Lustig',
  mathematisch: 'Mathematisch',
  detektiv: 'Detektiv',
  mysteriös: 'Mysteriös und seltsam',
  minecraft: 'Minecraft',
};

// Helper function to write a string to a DataView
function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Helper function to create a WAV file buffer from raw PCM data.
// The API returns raw 16-bit PCM audio data at a 24000 Hz sample rate.
function createWavBuffer(pcmData: ArrayBuffer): ArrayBuffer {
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const dataSize = pcmData.byteLength;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const headerSize = 44;

    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // true for little-endian
    writeString(view, 8, 'WAVE');

    // fmt subchunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // subchunk1 size (16 for PCM)
    view.setUint16(20, 1, true); // audio format (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data subchunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    const pcmView = new Uint8Array(pcmData);
    const wavView = new Uint8Array(buffer, headerSize);
    wavView.set(pcmView);

    return buffer;
}


const App = () => {
  const [riddle, setRiddle] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [userGuess, setUserGuess] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riddleHistory, setRiddleHistory] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('lustig');
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [aiClient] = useState(() => new GoogleGenAI({ apiKey: process.env.API_KEY }));
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [audioSource, setAudioSource] = useState<AudioBufferSourceNode | null>(null);

  const stopSpeaking = React.useCallback(() => {
    if (audioSource) {
      audioSource.stop();
      audioSource.disconnect();
      setAudioSource(null);
    }
    // Also cancel browser speech synthesis as a fallback
    if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [audioSource]);


  const speak = React.useCallback(async (text: string) => {
    if (!text || isSpeaking) return;

    let localAudioContext = audioContext;
    if (!localAudioContext) {
      try {
        localAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        setAudioContext(localAudioContext);
      } catch (e) {
        console.error("Web Audio API is not supported in this browser.", e);
        setError("Dein Browser unterstützt die Audio-Wiedergabe nicht.");
        return;
      }
    }
    
    if (localAudioContext.state === 'suspended') {
        await localAudioContext.resume();
    }

    stopSpeaking();
    setIsSpeaking(true);

    try {
      const response = await aiClient.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: ['AUDIO'],
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioData || typeof audioData !== 'string') {
        throw new Error("Keine gültigen Audiodaten in der API-Antwort gefunden.");
      }

      const binaryString = window.atob(audioData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const wavBuffer = createWavBuffer(bytes.buffer);
      
      const decodedAudioData = await localAudioContext.decodeAudioData(wavBuffer);

      const source = localAudioContext.createBufferSource();
      source.buffer = decodedAudioData;
      source.connect(localAudioContext.destination);
      source.start(0);

      source.onended = () => {
        setIsSpeaking(false);
        setAudioSource(null);
      };

      setAudioSource(source);

    } catch (e) {
      console.error("Fehler bei der Sprachsynthese:", e);
      setError("Entschuldigung, ein Fehler bei der Sprachsynthese ist aufgetreten.");
      setIsSpeaking(false);
    }
  }, [aiClient, audioContext, isSpeaking, stopSpeaking]);

  const fetchRiddle = React.useCallback(async () => {
    stopSpeaking();
      
    setIsLoading(true);
    setError(null);
    setFeedback(null);
    setUserGuess("");
    setRiddle(null);
    
    try {
      const categoryDescription = categoryMap[selectedCategory];
      let prompt = `Gib mir ein zufälliges, kurzes, ${categoryDescription}  Rätsel. Gib mir NUR das Rätsel und die Antwort im JSON-Format. Das JSON-Objekt muss ein 'raetsel' Feld (das Rätsel selbst) und ein 'antwort' Feld (die Lösung des Rätsels) haben.`;
      
      if (riddleHistory.length > 0) {
        const historyString = riddleHistory.map(r => `"${r}"`).join(", ");
        prompt += `\n\nWICHTIG: Das neue Rätsel darf keines der folgenden sein, die bereits gestellt wurden: [${historyString}]. Gib mir ein komplett anderes.`;
      }

      const response = await aiClient.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              raetsel: {
                type: Type.STRING,
                description: "Der Text des Rätsels."
              },
              antwort: {
                type: Type.STRING,
                description: "Die Lösung des Rätsels."
              }
            },
            required: ["raetsel", "antwort"]
          },
          temperature: 1,
        },
      });

      const jsonResponse = JSON.parse(response.text);
      if (jsonResponse.raetsel && jsonResponse.antwort) {
        setRiddle(jsonResponse.raetsel);
        setAnswer(jsonResponse.antwort);
        setRiddleHistory(prev => [...prev.slice(-9), jsonResponse.raetsel]);
      } else {
        throw new Error("Ungültiges JSON-Format von der API erhalten.");
      }
    } catch (e) {
      console.error(e);
      setError("Entschuldigung, ein Fehler ist aufgetreten. Bitte lade die Seite neu oder versuche es später erneut.");
    } finally {
      setIsLoading(false);
    }
  }, [aiClient, riddleHistory, selectedCategory, stopSpeaking]);

  React.useEffect(() => {
    fetchRiddle();
    
    return () => {
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGuessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userGuess.trim() || !answer) return;

    setIsVerifying(true);
    setFeedback(null);

    try {
      const verificationPrompt = `
        Du bist ein Schiedsrichter für ein Rätselspiel. Deine Aufgabe ist es zu beurteilen, ob die Antwort des Benutzers auf ein gegebenes Rätsel korrekt ist. Die Antwort muss nicht exakt mit der erwarteten Lösung übereinstimmen, aber sie muss semantisch korrekt sein. Zum Beispiel, wenn die erwartete Antwort 'Eine Landkarte' ist, sind 'Landkarte' oder 'Karte' auch korrekte Antworten.

        Rätsel: "${riddle}"
        Erwartete Antwort: "${answer}"
        Antwort des Benutzers: "${userGuess}"

        Ist die Antwort des Benutzers korrekt? Antworte NUR mit einem JSON-Objekt, das einen einzigen booleschen Schlüssel 'is_correct' hat.
      `;
      
      const response = await aiClient.models.generateContent({
        model: "gemini-2.5-flash",
        contents: verificationPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              is_correct: {
                type: Type.BOOLEAN,
                description: "True, wenn die Antwort des Benutzers korrekt ist, ansonsten false."
              }
            },
            required: ["is_correct"]
          }
        }
      });

      const result = JSON.parse(response.text);
      let feedbackMessage: string;
      
      if (result.is_correct) {
        feedbackMessage = "Richtig! Gut gemacht!";
        setFeedback({ message: feedbackMessage, type: 'success' });
      } else {
        feedbackMessage = `Leider falsch. Die richtige Antwort war: "${answer}"`;
        setFeedback({ message: feedbackMessage, type: 'error' });
      }
      speak(feedbackMessage);

    } catch (e) {
      console.error("Fehler bei der Überprüfung der Antwort:", e);
      const errorMessage = 'Entschuldigung, die Antwort konnte nicht überprüft werden. Versuche es erneut.';
      setFeedback({ message: errorMessage, type: 'error' });
      speak(errorMessage);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSpeak = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else if (riddle) {
      speak(riddle);
    }
  };

  return (
    <div className="container">
      <h1>Rätsel Spiel</h1>

      <div className="category-selector" role="radiogroup" aria-labelledby="category-label">
        <span id="category-label" className="sr-only">Rätselkategorie auswählen</span>
        {Object.keys(categoryLabels).map((key) => (
          <React.Fragment key={key}>
            <input
              type="radio"
              id={key}
              name="category"
              value={key}
              checked={selectedCategory === key}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={isLoading}
            />
            <label htmlFor={key}>{categoryLabels[key]}</label>
          </React.Fragment>
        ))}
      </div>
      
      {isLoading && <div className="loader">Lade neues Rätsel...</div>}
      
      {error && <div className="error-message">{error}</div>}

      {!isLoading && !error && riddle && (
        <>
          <div className="riddle-box" aria-live="polite">
            <p>{riddle}</p>
            <button 
              onClick={handleSpeak} 
              className="speak-button" 
              aria-label={isSpeaking ? "Vorlesen stoppen" : "Rätsel vorlesen"}
              title={isSpeaking ? "Vorlesen stoppen" : "Rätsel vorlesen"}
              disabled={isLoading || isVerifying}
            >
              {isSpeaking ? (
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M8 8h8v8H8z" opacity=".3"/><path d="M6 18h12V6H6v12zM8 8h8v8H8V8z"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" >
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              )}
            </button>
          </div>
          
          <form onSubmit={handleGuessSubmit}>
            <div className="form-group">
              <input
                type="text"
                value={userGuess}
                onChange={(e) => setUserGuess(e.target.value)}
                placeholder="Deine Antwort..."
                aria-label="Riddle answer input"
                disabled={!!feedback || isVerifying || isSpeaking}
              />
              <button type="submit" className="primary" disabled={!userGuess.trim() || !!feedback || isVerifying || isSpeaking}>
                {isVerifying ? 'Prüfe...' : 'Raten'}
              </button>
            </div>
          </form>

          {feedback && (
            <div className={`feedback ${feedback.type}`} role="alert">
              {feedback.message}
            </div>
          )}

          <div className="button-container">
            <button onClick={() => fetchRiddle()} className="secondary" disabled={isLoading || isSpeaking}>
              Neues Rätsel
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
