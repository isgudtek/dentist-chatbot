/* chat.js */
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');

    let dentistConfig = null;
    let ttsEnabled = false;

    const ttsCheckbox = document.getElementById('tts-checkbox');

    ttsCheckbox.addEventListener('change', (e) => {
        ttsEnabled = e.target.checked;
        if (!ttsEnabled) {
            window.speechSynthesis.cancel();
        }
    });

    async function loadConfig() {
        try {
            const res = await fetch('dentists.json');
            dentistConfig = await res.json();
        } catch (e) {
            console.error("Failed to load dentists.json", e);
        }
    }

    function speak(text) {
        if (!ttsEnabled) return;

        // Cancel any existing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);

        // Find a professional-sounding voice (prefer English/Local)
        const voices = window.speechSynthesis.getVoices();
        // Try to find a specific nice voice or just use default
        const preferredVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Natural')) || voices[0];
        if (preferredVoice) utterance.voice = preferredVoice;

        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        window.speechSynthesis.speak(utterance);
    }

    function getSystemPrompt() {
        const dentistRules = dentistConfig ? JSON.stringify(dentistConfig.dentists, null, 2) : "Check dentists.json";
        return {
            role: "system",
            content: `You are a professional dental reservation assistant for "SmileCare Dental Clinic". 
            Current Local Time: ${new Date().toString()}.
            
            Clinic Rules & Dentist Schedules:
            ${dentistRules}
            
            Strict Booking Rules:
            1. ALL TIMES ARE LOCAL. When calling tools, generate ISO 8601 strings WITHOUT the 'Z' (e.g., "2026-02-13T10:00:00").
            2. Reservation Duration: Exactly 1 hour. (e.g., 10:00:00 to 11:00:00).
            3. MANDATORY TITLE FORMAT: "Appointment with Dr. [Doctor Name] for [Patient Name] (Reason: [Procedure/Reason]) - [Phone Number]". 
               - If you fail this format exactly, the system will REJECT the booking.
            4. DO NOT DOUBLE BOOK: One doctor = one patient at a time.
            5. AVAILABILITY: Multiple appointments at the same hour are ONLY okay if they are for DIFFERENT doctors.
            6. ONLY book a doctor for their specialized service on their available days.
            7. ALWAYS call 'get_calendar_events' first. Check the search results: if an event title contains the doctor's name during that hour, they are BUSY.
            8. STRICT PRIVACY: NEVER share patient names. Just say "Dr. [Name] is occupied".
            9. CONFIRM BEFORE BOOKING: Once you have the availability and user details, you MUST recap EVERYTHING (Doctor, Time, Patient, Procedure, Phone) and ask: "Would you like me to book it?" 
               - DO NOT call 'create_reservation' until the user says "Yes" or "Confirm".
            
            Conversation Flow:
            1. Collect Name, Procedure, and Phone Number.
            2. Check availability via 'get_calendar_events'.
            3. Recap findings and ask for final confirmation: "Would you like me to book it?"
            4. Wait for user confirmation before calling 'create_reservation'.`
        };
    }

    const messages = [];

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        if (!dentistConfig) await loadConfig();

        // Initialize or Update system prompt as the first message
        const sysPrompt = getSystemPrompt();
        if (messages.length === 0) {
            messages.push(sysPrompt);
        } else {
            messages[0] = sysPrompt;
        }

        // Add user message to UI
        appendMessage('user', text);
        chatInput.value = '';

        // Add to history
        messages.push({ role: 'user', content: text });

        // Show typing indicator (simple)
        const typingMsg = appendMessage('assistant', '...');

        try {
            await processAIResponse(typingMsg);
        } catch (error) {
            console.error('Error:', error);
            typingMsg.remove();
            appendMessage('assistant', "Oops! Something went wrong.");
        }
    }

    async function processAIResponse(typingMsg) {
        let response = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: messages })
        });

        let data = await response.json();

        while (data.choices && data.choices[0] && data.choices[0].message.tool_calls) {
            const message = data.choices[0].message;
            messages.push(message);

            for (const toolCall of message.tool_calls) {
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                let result;
                if (functionName === 'get_calendar_events') {
                    result = await handleGetCalendar();
                } else if (functionName === 'create_reservation') {
                    result = await handleCreateReservation(args);
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: JSON.stringify(result)
                });
            }

            // Get next response from AI
            response = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages })
            });
            data = await response.json();
        }

        typingMsg.remove();

        if (data.choices && data.choices[0]) {
            const aiResponse = data.choices[0].message.content;
            if (aiResponse) {
                appendMessage('assistant', aiResponse);
                messages.push({ role: 'assistant', content: aiResponse });
                speak(aiResponse); // Trigger TTS
            } else {
                appendMessage('assistant', "I apologize, I'm having trouble finding the right words. Let's try again!");
            }
        } else {
            appendMessage('assistant', "I'm sorry, I'm having trouble connecting to my brain.");
        }
    }

    async function handleGetCalendar() {
        const config = await fetchConfig();
        if (!config.CALENDAR_PROXY_URL) return { error: "Calendar not configured" };

        try {
            const res = await fetch(config.CALENDAR_PROXY_URL);
            const events = await res.json();

            // MAP TO LOCAL ISO (WALL TIME)
            // This satisfies the "User and Calendar in same timezone" by 
            // removing the Z/UTC offset and showing the local numeric values.
            if (Array.isArray(events)) {
                return events.map(ev => {
                    // Convert date to local ISO string, then strip the 'Z'
                    const dateObj = new Date(ev.start);
                    // Adjust for local timezone offset manually to get a "Local ISO" string
                    const offset = dateObj.getTimezoneOffset() * 60000;
                    const localISOTime = (new Date(dateObj - offset)).toISOString().slice(0, -1);

                    const endDateObj = new Date(ev.end);
                    const localISOEndTime = (new Date(endDateObj - offset)).toISOString().slice(0, -1);

                    return {
                        title: ev.title,
                        start: localISOTime,
                        end: localISOEndTime
                    };
                });
            }
            return events;
        } catch (e) {
            return { error: "Failed to fetch calendar" };
        }
    }

    async function handleCreateReservation(args) {
        const config = await fetchConfig();
        if (!config.CALENDAR_PROXY_URL) return { error: "Calendar not configured" };

        // --- ENFORCE TITLE FORMAT WITH REASON ---
        // We look for "Dr. [Name]" anywhere in the title to be permissive with previous bookings
        const doctorMatch = args.title.match(/Dr\.\s+(\w+)/i);
        if (!doctorMatch) {
            return {
                error: "INVALID_TITLE",
                message: "CRITICAL ERROR: Title MUST include 'Dr. [Name]'. Fix it and retry."
            };
        }
        const requestedDoctor = doctorMatch[0];

        // --- HARD CONFLICT CHECK ---
        const events = await handleGetCalendar();
        if (Array.isArray(events)) {
            const newStart = new Date(args.startTime).getTime();
            const newEnd = new Date(args.endTime).getTime();

            const conflict = events.some(ev => {
                const evStart = new Date(ev.start).getTime();
                const evEnd = new Date(ev.end).getTime();

                const isOverlapping = (newStart < evEnd) && (newEnd > evStart);
                const isSameDoctor = ev.title.includes(requestedDoctor);

                if (isOverlapping && isSameDoctor) {
                    console.warn(`CONFLICT BLOCK: ${requestedDoctor} is already booked at ${ev.start} with event: "${ev.title}"`);
                }
                return isOverlapping && isSameDoctor;
            });

            if (conflict) {
                return {
                    error: "CONFLICT",
                    message: `${requestedDoctor} is busy during this range. Suggest a different time.`
                };
            }
        }

        const res = await fetch(config.CALENDAR_PROXY_URL, {
            method: 'POST',
            body: JSON.stringify(args)
        });
        return await res.json();
    }

    async function fetchConfig() {
        // Simple way to get PHP constants in JS for this local setup
        // Ideally we'd have a separate endpoint, but let's parse config.php or just hardcode for simplicity
        // For now, let's assume we can fetch it via a small helper
        const res = await fetch('get_proxy_url.php');
        return await res.json();
    }

    function appendMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        msgDiv.textContent = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgDiv;
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});
