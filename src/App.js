import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
  createUserWithEmailAndPassword, // Added for email/password signup
  signInWithEmailAndPassword,     // Added for email/password login
  signOut                       // Added for logout
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';

// Define global variables for Firebase configuration and app ID
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// IMPORTANT: YOUR ACTUAL FIREBASE PROJECT CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBe-g4sPleK6EANM2QXhjnuHFz7GXn9l3g",
  authDomain: "solo-level-gem-v2.firebaseapp.com",
  projectId: "solo-level-gem-v2",
  storageBucket: "solo-level-gem-v2.firebasestorage.app",
  messagingSenderId: "856640373652",
  appId: "1:856640373652:web:9a0d053bd0284dff078581"
};

// Refined check for initialAuthToken: only use if it's a non-empty string (likely a valid token)
const initialAuthToken = (typeof __initial_auth_token === 'string' && __initial_auth_token.length > 10) // Custom tokens are typically long
  ? __initial_auth_token
  : null;

// Define predefined activities and their XP values
const predefinedActivities = {
  'Complete 1-hour study session': 50,
  'Complete a challenging coding exercise': 75,
  'Successfully debug a complex issue': 100,
  'Brush Teeth (Morning)': 5,
  'Brush Teeth (Evening)': 5,
  'Bath/Shower': 10,
  'Breakfast': 10,
  'Lunch': 10,
  'Dinner': 10,
  'Achieve 7-8 hours of sleep': 25,
};

// Function to calculate XP needed for the next level
const getXpForNextLevel = (currentLevel) => {
  // Linear progression: Level 1 to 2: 200 XP, Level 2 to 3: 300 XP, etc.
  return 100 * (currentLevel + 1);
};

function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState(null); // New state for user email
  const [currentXp, setCurrentXp] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const [generatedQuests, setGeneratedQuests] = useState([]);
  const [showQuestsModal, setShowQuestsModal] = useState(false);
  const [customActivityName, setCustomActivityName] = useState('');
  const [customActivityXp, setCustomActivityXp] = useState('');
  const [userDefinedActivities, setUserDefinedActivities] = useState({}); // New state for user-defined activities

  // Auth specific states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLogin, setIsLogin] = useState(true); // true for login, false for signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Function to show a custom modal message
  const showMessageBox = (content) => {
    setModalContent(content);
    setShowModal(true);
  };

  // Initialize Firebase and set up authentication listener
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);
      setDb(firestore);
      setAuth(authentication);

      // Listen for auth state changes
      const unsubscribeAuth = onAuthStateChanged(authentication, async (user) => {
        if (user) {
          setUserId(user.uid);
          setUserEmail(user.email); // Set user email if available
          console.log("User authenticated:", user.uid, user.email || 'anonymous');

          // If user logs in after being anonymous, migrate data (basic example)
          // This is a complex topic for full implementation, but a placeholder for thought.
          // For now, new sign-ins will start fresh or load their existing data.

          // Load user data and activities for the authenticated user
          const userDocRef = doc(firestore, `artifacts/${appId}/users/${user.uid}/levelingSystem`, 'userData');
          const userActivitiesDocRef = doc(firestore, `artifacts/${appId}/users/${user.uid}/levelingSystem`, 'userActivities');

          const userSnap = await getDoc(userDocRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            setCurrentXp(data.current_xp || 0);
            setCurrentLevel(data.current_level || 1);
          } else {
            await setDoc(userDocRef, { current_xp: 0, current_level: 1 });
          }

          const activitiesSnap = await getDoc(userActivitiesDocRef);
          if (activitiesSnap.exists()) {
            setUserDefinedActivities(activitiesSnap.data().activities || {});
          } else {
            await setDoc(userActivitiesDocRef, { activities: {} });
          }

        } else {
          // If no user is authenticated, try anonymous sign-in for new users
          setUserId(null);
          setUserEmail(null);
          setCurrentXp(0);
          setCurrentLevel(1);
          setActivityLogs([]);
          setUserDefinedActivities({});
          console.log("No user authenticated. Attempting anonymous sign-in...");

          try {
            // Only attempt signInWithCustomToken if initialAuthToken is actually provided and is a long string (like a valid token)
            if (initialAuthToken) {
              await signInWithCustomToken(authentication, initialAuthToken);
            } else {
              await signInAnonymously(authentication);
            }
          } catch (error) {
            console.error("Anonymous sign-in failed:", error);
            showMessageBox(`App Initialization Error: ${error.message}. Please refresh or try again.`);
          }
        }
        setLoading(false); // Authentication check is complete
      });

      return () => unsubscribeAuth();
    } catch (error) {
      console.error("Failed to initialize Firebase:", error);
      showMessageBox(`Failed to initialize Firebase: ${error.message}`);
      setLoading(false);
    }
  }, []); // Removed db and auth from dependencies to avoid re-initializing Firebase

  // Fetch activity logs when userId and db are available (separate effect for logs)
  useEffect(() => {
    if (userId && db) {
      const activityLogsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/activityLogs`);
      const q = query(activityLogsCollectionRef, orderBy('timestamp', 'desc'), limit(10));
      const unsubscribeActivityLogs = onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setActivityLogs(logs);
      }, (error) => {
        console.error("Error fetching activity logs:", error);
        showMessageBox(`Error fetching activity logs: ${error.message}`);
      });
      return () => unsubscribeActivityLogs();
    }
  }, [db, userId]);


  // Function to call Gemini API for Level Up Insight
  const getLevelUpInsight = async (level) => {
    setLlmLoading(true);
    try {
      const prompt = `The user just leveled up to Level ${level} in their personal leveling system. Provide a short, motivational, and thematic message (like a system notification) congratulating them and giving a brief, inspiring thought for their continued journey. Do not explicitly mention 'Solo Leveling' or 'manhwa' in the message itself, but keep the tone similar to system messages from a powerful leveling system.`;
      let chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = { contents: chatHistory };
      const apiKey = ""; // Canvas will automatically provide this
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        return result.candidates[0].content.parts[0].text;
      } else {
        console.error("Gemini API returned an unexpected structure for level up insight:", result);
        return "System Notification: Level Up!";
      }
    } catch (error) {
      console.error("Error calling Gemini API for level up insight:", error);
      return "System Notification: Level Up!";
    } finally {
      setLlmLoading(false);
    }
  };

  // Function to call Gemini API for Daily Quest Generation
  const generateDailyQuests = async () => {
    setLlmLoading(true);
    setGeneratedQuests([]); // Clear previous quests
    try {
      const prompt = `Generate 3-5 daily activities or 'quests' for a personal leveling system. Each quest should have a name and a suggested XP value. Focus on activities related to personal growth, coding, and well-being. Format as a JSON array of objects with 'name' (string) and 'xp' (number) keys. Example: [{"name": "Meditate for 15 minutes", "xp": 15}]`;
      let chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = {
        contents: chatHistory,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                "name": { "type": "STRING" },
                "xp": { "type": "NUMBER" }
              }
            }
          }
        }
      };
      const apiKey = ""; // Canvas will automatically provide this
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const jsonString = result.candidates[0].content.parts[0].text;
        try {
          const parsedQuests = JSON.parse(jsonString);
          setGeneratedQuests(parsedQuests);
          setShowQuestsModal(true); // Show the modal with generated quests
        } catch (parseError) {
          console.error("Failed to parse LLM response as JSON:", parseError);
          showMessageBox("Failed to generate quests. Please try again.");
        }
      } else {
        console.error("Gemini API returned an unexpected structure for quests:", result);
        showMessageBox("Failed to generate quests. Please try again.");
      }
    } catch (error) {
      console.error("Error calling Gemini API for quest generation:", error);
      showMessageBox(`Error generating quests: ${error.message}`);
    } finally {
      setLlmLoading(false);
    }
  };

  // Function to add a user-defined activity
  const addCustomActivity = async () => {
    if (!db || !userId) {
      showMessageBox("App not ready. Please wait for authentication.");
      return;
    }
    if (!customActivityName.trim() || isNaN(parseInt(customActivityXp))) {
      showMessageBox("Please enter a valid activity name and XP value.");
      return;
    }

    const xpValue = parseInt(customActivityXp);
    if (xpValue <= 0) {
      showMessageBox("XP value must be a positive number.");
      return;
    }

    const userActivitiesDocRef = doc(db, `artifacts/${appId}/users/${userId}/levelingSystem`, 'userActivities');

    try {
      const docSnap = await getDoc(userActivitiesDocRef);
      let existingActivities = {};
      if (docSnap.exists()) {
        existingActivities = docSnap.data().activities || {};
      }

      if (predefinedActivities[customActivityName] || existingActivities[customActivityName]) {
        showMessageBox("Activity with this name already exists. Please choose a different name.");
        return;
      }

      const updatedActivities = {
        ...existingActivities,
        [customActivityName]: xpValue,
      };

      await setDoc(userActivitiesDocRef, { activities: updatedActivities });
      setCustomActivityName('');
      setCustomActivityXp('');
      setMessage(`Custom activity "${customActivityName}" added successfully!`);
    } catch (error) {
      console.error("Error adding custom activity:", error);
      showMessageBox(`Error adding custom activity: ${error.message}`);
    }
  };


  // Function to log an activity and update XP/Level
  const logActivity = useCallback(async (activityName) => {
    if (!db || !userId) {
      showMessageBox("App not ready. Please wait for authentication.");
      return;
    }

    // Determine XP from either predefined or user-defined activities
    let xpGained = predefinedActivities[activityName];
    if (xpGained === undefined && userDefinedActivities[activityName] !== undefined) {
      xpGained = userDefinedActivities[activityName];
    }

    if (xpGained === undefined) {
      showMessageBox("Invalid activity.");
      return;
    }

    setMessage(''); // Clear previous messages

    try {
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/levelingSystem`, 'userData');
      const activityLogsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/activityLogs`);

      // Atomically update user data
      const docSnap = await getDoc(userDocRef);
      let currentData = { current_xp: 0, current_level: 1 };
      if (docSnap.exists()) {
        currentData = docSnap.data();
      }

      let newXp = currentData.current_xp + xpGained;
      let newLevel = currentData.current_level;
      let levelUpMessage = '';
      let llmLevelUpInsight = '';

      // Check for level up
      while (newXp >= getXpForNextLevel(newLevel)) {
        newXp -= getXpForNextLevel(newLevel);
        newLevel++;
        levelUpMessage += `LEVEL UP! You are now Level ${newLevel}! `;
        // Call LLM for level up insight
        llmLevelUpInsight = await getLevelUpInsight(newLevel);
      }

      await updateDoc(userDocRef, {
        current_xp: newXp,
        current_level: newLevel,
      });

      // Log the activity
      await addDoc(activityLogsCollectionRef, {
        activity_name: activityName,
        xp_gained: xpGained,
        timestamp: new Date(),
      });

      const msg = `Logged "${activityName}". Gained ${xpGained} XP. Current XP: ${newXp}. Current Level: ${newLevel}. ${levelUpMessage}`;
      setMessage(msg);
      console.log(msg);

      if (levelUpMessage) {
        showMessageBox(levelUpMessage + (llmLevelUpInsight ? `\n\n${llmLevelUpInsight}` : ''));
      }

    } catch (error) {
      console.error("Error logging activity:", error);
      showMessageBox(`Error logging activity: ${error.message}`);
    }
  }, [db, userId, userDefinedActivities]); // Added userDefinedActivities to useCallback dependencies

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-gray-100">
        <div className="text-lg font-semibold">Loading app...</div>
      </div>
    );
  }

  const xpNeededForNextLevel = getXpForNextLevel(currentLevel);
  const progressPercentage = (currentXp / xpNeededForNextLevel) * 100;

  // Combine predefined and user-defined activities for display
  const allActivities = { ...predefinedActivities, ...userDefinedActivities };

  // Handle authentication form submission
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      setShowAuthModal(false); // Close modal on success
      setEmail('');
      setPassword('');
    } catch (error) {
      setAuthError(error.message);
      console.error("Authentication error:", error);
    }
  };

  const handleLogout = async () => {
    if (auth) {
      try {
        await signOut(auth);
        showMessageBox("Logged out successfully. Your progress is saved!");
      } catch (error) {
        showMessageBox(`Logout failed: ${error.message}`);
        console.error("Logout error:", error);
      }
    }
  };


  return (
    <div
      className="min-h-screen bg-cover bg-center bg-fixed font-inter p-4 sm:p-6 flex flex-col items-center justify-center relative overflow-hidden"
      style={{
        backgroundImage: 'url("https://images.pexels.com/photos/1768512/pexels-photo-1768512.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=750&w=1260")',
        backgroundBlendMode: 'overlay',
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
      }}
    >
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <script src="https://cdn.tailwindcss.com"></script>

      {/* Subtle glowing particles effect */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        {Array.from({ length: 50 }).map((_, i) => (
          <div
            key={i}
            className="absolute bg-purple-400 rounded-full opacity-0 animate-glow-particle"
            style={{
              width: `${Math.random() * 5 + 2}px`,
              height: `${Math.random() * 5 + 2}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${Math.random() * 10 + 5}s`,
              boxShadow: '0 0 8px 4px rgba(168, 85, 247, 0.7)',
            }}
          ></div>
        ))}
      </div>

      {/* General Message Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 text-white p-6 rounded-xl shadow-2xl max-w-sm w-full text-center border-2 border-purple-700 animate-fade-in custom-glow-border">
            <h3 className="text-2xl font-bold mb-4 text-purple-400 drop-shadow-md">System Message</h3>
            <p className="mb-6 text-lg whitespace-pre-wrap">{modalContent}</p>
            <button
              onClick={() => setShowModal(false)}
              className="px-6 py-3 bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 text-white font-semibold rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 border border-purple-500 custom-button-glow"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* Generated Quests Modal */}
      {showQuestsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 text-white p-6 rounded-xl shadow-2xl max-w-lg w-full border-2 border-green-700 animate-fade-in custom-glow-border">
            <h3 className="text-2xl font-bold mb-4 text-green-400 text-center drop-shadow-md">✨ Suggested Daily Quests ✨</h3>
            {generatedQuests.length > 0 ? (
              <ul className="space-y-3 mb-6">
                {generatedQuests.map((quest, index) => (
                  <li key={index} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center border border-gray-700 shadow-inner-dark">
                    <span className="font-medium text-lg text-gray-200">{quest.name}</span>
                    <span className="text-green-400 font-bold">+{quest.xp} XP</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center text-gray-400 mb-6">No quests generated. Try again!</p>
            )}
            <button
              onClick={() => setShowQuestsModal(false)}
              className="px-6 py-3 bg-gradient-to-r from-green-700 to-teal-700 hover:from-green-800 hover:to-teal-800 text-white font-semibold rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 border border-green-500 w-full custom-button-glow"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Authentication Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 text-white p-6 rounded-xl shadow-2xl max-w-sm w-full border-2 border-indigo-700 animate-fade-in custom-glow-border">
            <h3 className="text-2xl font-bold mb-4 text-indigo-400 text-center drop-shadow-md">
              {isLogin ? 'Login to System' : 'Register New Hunter'}
            </h3>
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-400 shadow-inner-dark"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-400 shadow-inner-dark"
                required
              />
              {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
              <button
                type="submit"
                className="w-full px-6 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 border border-indigo-500 custom-button-glow"
              >
                {isLogin ? 'Login' : 'Register'}
              </button>
            </form>
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="mt-4 w-full text-sm text-indigo-300 hover:text-indigo-200 transition-colors duration-200"
            >
              {isLogin ? 'Need an account? Register' : 'Already have an account? Login'}
            </button>
            <button
              onClick={() => setShowAuthModal(false)}
              className="mt-4 w-full text-sm text-gray-400 hover:text-gray-300 transition-colors duration-200"
            >
              Close
            </button>
          </div>
        </div>
      )}


      <div className="relative z-10 bg-gray-900 bg-opacity-90 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-3xl mb-8 border-2 border-purple-700 transform transition-all duration-300 hover:scale-[1.01] custom-glow-border">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-center text-white mb-6 drop-shadow-lg">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-400 text-shadow-glow">
            SHADOW MONARCH SYSTEM
          </span>
        </h1>

        <div className="flex justify-center gap-4 mb-6">
          {!userId || userEmail === null ? ( // Show login/signup if not logged in or is anonymous
            <button
              onClick={() => { setShowAuthModal(true); setIsLogin(true); setAuthError(''); }}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 border border-blue-500 custom-button-glow"
            >
              Login / Register
            </button>
          ) : (
            <>
              <span className="text-lg text-gray-300 flex items-center">
                Logged in as: <span className="font-bold text-indigo-300 ml-2">{userEmail || 'Anonymous Hunter'}</span>
              </span>
              <button
                onClick={handleLogout}
                className="px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white font-semibold rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 border border-red-500 custom-button-glow"
              >
                Logout
              </button>
            </>
          )}
        </div>


        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 text-white">
          <div className="bg-gray-800 p-5 rounded-xl text-center shadow-lg border border-indigo-600 transform transition-transform duration-200 hover:scale-105 custom-card-glow">
            <p className="text-xl font-semibold text-indigo-300">Current Level:</p>
            <p className="text-5xl font-bold text-purple-400 mt-2 animate-pulse">{currentLevel}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl text-center shadow-lg border border-purple-600 transform transition-transform duration-200 hover:scale-105 custom-card-glow">
            <p className="text-xl font-semibold text-purple-300">Current XP:</p>
            <p className="text-5xl font-bold text-indigo-400 mt-2 animate-pulse">{currentXp}</p>
          </div>
        </div>

        <div className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700 mb-8 custom-card-glow">
          <p className="text-xl font-semibold text-white mb-3">
            XP to next level (Level {currentLevel + 1}): <span className="text-purple-300">{xpNeededForNextLevel - currentXp} XP</span>
          </p>
          <div className="w-full bg-gray-700 rounded-full h-4">
            <div
              className="bg-gradient-to-r from-purple-600 to-indigo-600 h-4 rounded-full transition-all duration-500 ease-out shadow-inner-lg"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>

        {userId && (
          <div className="text-center text-sm text-gray-500 mb-6">
            System ID: <span className="font-mono break-all text-gray-400">{userId}</span>
          </div>
        )}

        {message && (
          <div className="bg-green-800 bg-opacity-70 text-green-200 p-4 rounded-lg mb-6 text-center shadow-md border border-green-600 animate-fade-in custom-glow-border">
            {message}
          </div>
        )}

        <h2 className="text-3xl font-bold text-white mb-5 text-center drop-shadow-md">Log Your Progress</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(allActivities).map(([activityName, xpValue]) => (
            <button
              key={activityName}
              onClick={() => logActivity(activityName)}
              className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-indigo-700 to-purple-800 hover:from-indigo-800 hover:to-purple-900 text-white rounded-xl shadow-lg transition duration-300 ease-in-out transform hover:scale-105
                         focus:outline-none focus:ring-4 focus:ring-purple-500 focus:ring-opacity-70 border border-indigo-500 group custom-button-glow"
            >
              <span className="text-lg font-semibold text-center group-hover:text-purple-300 transition-colors duration-200">{activityName}</span>
              <span className="text-sm mt-1 opacity-90 group-hover:opacity-100 transition-opacity duration-200 text-purple-200">+{xpValue} XP</span>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={generateDailyQuests}
            disabled={llmLoading}
            className="px-8 py-4 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white font-extrabold text-xl rounded-xl shadow-2xl transition duration-300 ease-in-out transform hover:scale-105
                       focus:outline-none focus:ring-4 focus:ring-green-500 focus:ring-opacity-70 border border-green-400 flex items-center justify-center mx-auto custom-button-glow"
          >
            {llmLoading ? (
              <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              '✨ Generate Daily Quests ✨'
            )}
          </button>
        </div>

        {/* Section for adding custom activities */}
        <div className="mt-10 pt-8 border-t-2 border-gray-700 custom-border-glow">
          <h2 className="text-3xl font-bold text-white mb-5 text-center drop-shadow-md">Define New Activity</h2>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <input
              type="text"
              placeholder="Activity Name (e.g., Learn React Hook)"
              value={customActivityName}
              onChange={(e) => setCustomActivityName(e.target.value)}
              className="flex-grow p-3 rounded-lg bg-gray-800 text-white border-2 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-400 shadow-inner-dark"
            />
            <input
              type="number"
              placeholder="XP Value"
              value={customActivityXp}
              onChange={(e) => setCustomActivityXp(e.target.value)}
              className="w-24 p-3 rounded-lg bg-gray-800 text-white border-2 border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-400 shadow-inner-dark"
            />
            <button
              onClick={addCustomActivity}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105
                         focus:outline-none focus:ring-4 focus:ring-purple-500 focus:ring-opacity-70 border border-purple-500 custom-button-glow"
            >
              Add Custom Activity
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 bg-gray-900 bg-opacity-90 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-3xl border-2 border-purple-700 custom-glow-border">
        <h2 className="text-3xl font-bold text-white mb-5 text-center drop-shadow-md">Recent System Records</h2>
        {activityLogs.length === 0 ? (
          <p className="text-center text-gray-500">No records found. Begin your journey!</p>
        ) : (
          <ul className="space-y-4">
            {activityLogs.map((log) => (
              <li
                key={log.id}
                className="flex flex-col sm:flex-row justify-between items-center bg-gray-800 p-4 rounded-lg shadow-md border border-gray-700 transition-transform duration-200 hover:scale-[1.02] shadow-inner-dark"
              >
                <span className="font-medium text-white text-lg mb-1 sm:mb-0">{log.activity_name}</span>
                <span className="text-purple-400 font-bold text-xl">
                  +{log.xp_gained} XP
                </span>
                <span className="text-xs text-gray-500 mt-1 sm:mt-0">
                  {log.timestamp?.toDate().toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
       {/* Tailwind CSS custom animations and keyframes */}
       <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }

        @keyframes glow-particle-animation {
          0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
          25% { opacity: 0.8; }
          50% { transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(1.2); opacity: 0.6; }
          75% { opacity: 0.4; }
          100% { transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(0.8); opacity: 0; }
        }
        .animate-glow-particle {
          animation: glow-particle-animation infinite;
          --tw-translate-x: calc(var(--random-x) * 1px);
          --tw-translate-y: calc(var(--random-y) * 1px);
        }

        .text-shadow-glow {
          text-shadow: 0 0 5px rgba(168, 85, 247, 0.6), 0 0 10px rgba(168, 85, 247, 0.4);
        }

        .custom-glow-border {
          box-shadow: 0 0 15px rgba(168, 85, 247, 0.4), 0 0 25px rgba(168, 85, 247, 0.2);
        }

        .custom-card-glow:hover {
          box-shadow: 0 0 20px rgba(168, 85, 247, 0.6), 0 0 30px rgba(168, 85, 247, 0.3);
        }

        .custom-button-glow:hover {
          box-shadow: 0 0 15px rgba(168, 85, 247, 0.6), 0 0 25px rgba(168, 85, 247, 0.3);
        }

        .shadow-inner-dark {
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6);
        }
      `}</style>
    </div>
  );
}

export default App;
