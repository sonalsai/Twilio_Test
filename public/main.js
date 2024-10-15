const WS_URL = `wss://api.aiscribe.quipohealth.com/ws`;

const form = document.getElementById("room-name-form");
const roomNameInput = document.getElementById("room-name-input");
const container = document.getElementById("video-container");
let socket;
let room;
const activeParticipants = new Map();
let isWebSocketReady = false;

let audioChunks = []; // To store the received audio data

const startRoom = async (event) => {
    event.preventDefault();
    form.style.visibility = "hidden";

    try {
        const roomName = roomNameInput.value;

        // Fetch Access Token
        const response = await fetch("/join-room", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ roomName: roomName }),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch token: ${response.statusText}`);
        }

        const { token } = await response.json();

        // Join video room
        room = await joinVideoRoom(roomName, token);
        console.log(`Joined room: ${room.name}`);

        // Render local and remote participants
        handleConnectedParticipant(room.localParticipant);
        room.participants.forEach(handleConnectedParticipant);
        room.on("participantConnected", handleConnectedParticipant);

        // Handle disconnections
        room.on("participantDisconnected", handleDisconnectedParticipant);
        window.addEventListener("pagehide", () => handleRoomDisconnection(room));
        window.addEventListener("beforeunload", () => handleRoomDisconnection(room));

        // WebSocket connection
        socket = new WebSocket(WS_URL);
        socket.onopen = () => {
            console.log("WebSocket connected");
            isWebSocketReady = true;
        };
        socket.onmessage = (event) => {
            console.log("Received WebSocket message:", event.data);
            handleWebSocketMessage(event);
        };
        socket.onerror = (error) => console.error("WebSocket error:", error);
        socket.onclose = () => {
            console.log("WebSocket closed");
            isWebSocketReady = false;
        };
    } catch (error) {
        console.error("Error starting room:", error);
    }
};

const handleConnectedParticipant = (participant) => {
    try {
        console.log(`Participant connected: ${participant.identity}`);
        const participantDiv = document.createElement("div");
        participantDiv.setAttribute("id", participant.identity);
        container.appendChild(participantDiv);

        console.log(participant);

        participant.tracks.forEach((trackPublication) => {
            handleTrackPublication(trackPublication, participant);
        });

        participant.on("trackPublished", (trackPublication) => 
            handleTrackPublication(trackPublication, participant));

        participant.on("trackSubscribed", (track) => {
            console.log(`Track subscribed: ${track.kind}`);
            if (track.kind === 'audio') {
                console.log(`Starting audio recording for ${participant.identity}`);
                const mediaRecorder = sendAudioToWebSocket(track);
                activeParticipants.set(participant.identity, mediaRecorder);
            }
        });

        participant.on("trackUnsubscribed", (track) => {
            if (track.kind === 'audio') {
                console.log(`Stopping audio recording for ${participant.identity}`);
                const mediaRecorder = activeParticipants.get(participant.identity);
                if (mediaRecorder) {
                    mediaRecorder.stop();
                    activeParticipants.delete(participant.identity);
                }
            }
        });
    } catch (error) {
        console.error("Error handling connected participant:", error);
    }
};

const handleTrackPublication = (trackPublication, participant) => {
    try {
        console.log(`Track published: ${trackPublication.kind}`);
        if (trackPublication.track) {
            displayTrack(trackPublication.track, participant);
        }
        trackPublication.on("subscribed", (track) => displayTrack(track, participant));
    } catch (error) {
        console.error("Error handling track publication:", error);
    }
};

const displayTrack = (track, participant) => {
    try {
        const participantDiv = document.getElementById(participant.identity);
        participantDiv.append(track.attach());
        if (track.kind === 'audio') {
            console.log(`Audio track attached for ${participant.identity}`);
            // Add a visual indicator for audio capture (optional)
        }
    } catch (error) {
        console.error("Error displaying track:", error);
    }
};

const sendAudioToWebSocket = (audioTrack) => {
    try {
        const mediaStream = new MediaStream();
        mediaStream.addTrack(audioTrack.mediaStreamTrack);

        const options = { mimeType: "audio/webm" };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            throw new Error(`Unsupported MIME type: ${options.mimeType}`);
        }

        const mediaRecorder = new MediaRecorder(mediaStream, options);
        console.log(mediaRecorder);

        mediaRecorder.ondataavailable = (event) => {
            console.log("on data");
            if (event.data.size > 0) {
                console.log("Captured audio chunk size:", event.data.size);
                audioChunks.push(event.data); // Store the audio data
                if (isWebSocketReady) {
                    socket.send(event.data);
                    console.log("Audio data sent to WebSocket");
                } else {
                    console.warn("WebSocket is not ready, cannot send data");
                }
            } else {
                console.warn("Captured audio data is empty");
            }
        };

        mediaRecorder.onerror = (error) => {
            console.error("MediaRecorder error:", error);
        };

        mediaRecorder.start(1000);  // Capture audio every second
        console.log("MediaRecorder started");

        return mediaRecorder;
    } catch (error) {
        console.error("Error in sendAudioToWebSocket:", error);
    }
};

const handleWebSocketMessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcription') {
            displayTranscription(data);
        } else {
            console.log("Received unknown message type:", data.type);
        }
    } catch (error) {
        console.error("Error parsing WebSocket message:", error);
    }
};

const displayTranscription = (transcription) => {
    try {
        const participantDiv = document.getElementById(transcription.participant);
        const transcriptionElement = document.createElement("p");
        transcriptionElement.textContent = transcription.text;
        participantDiv.appendChild(transcriptionElement);
    } catch (error) {
        console.error("Error displaying transcription:", error);
    }
};

const handleDisconnectedParticipant = (participant) => {
    try {
        console.log(`Participant disconnected: ${participant.identity}`);
        participant.removeAllListeners();
        const participantDiv = document.getElementById(participant.identity);
        participantDiv.remove();
        
        const mediaRecorder = activeParticipants.get(participant.identity);
        if (mediaRecorder) {
            mediaRecorder.stop();
            activeParticipants.delete(participant.identity);
        }
    } catch (error) {
        console.error("Error handling disconnected participant:", error);
    }
};

const handleRoomDisconnection = (room) => {
    console.log("Disconnecting from room");
    room.localParticipant.tracks.forEach(publication => {
        publication.track.stop();
        publication.unpublish();
    });

    activeParticipants.forEach(mediaRecorder => {
        mediaRecorder.stop();
    });
    activeParticipants.clear();

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    }

    room.disconnect();

};

const joinVideoRoom = async (roomName, token) => {
    try {
        console.log(`Attempting to join room: ${roomName}`);
        return await Twilio.Video.connect(token, { room: roomName });
    } catch (error) {
        console.error("Error joining video room:", error);
        throw error;
    }
};

form.addEventListener("submit", startRoom);
