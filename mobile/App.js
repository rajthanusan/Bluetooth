"use client"

import { useState, useEffect, useRef } from "react"
import {
  View,
  Text,
  TextInput,
  Button,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  PermissionsAndroid,
  AppState,
  NativeEventEmitter,
  NativeModules,
  ToastAndroid,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native"
import RNBluetoothClassic from "react-native-bluetooth-classic"
import AudioRecorderPlayer from "react-native-audio-recorder-player"
import RNFS from "react-native-fs"
import axios from "axios"
import { Buffer } from "buffer"


global.Buffer = Buffer

const App = () => {
  const [connectedDevice, setConnectedDevice] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState("")
  const [availableDevices, setAvailableDevices] = useState([])
  const [isScanning, setIsScanning] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentAudioFile, setCurrentAudioFile] = useState(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [isSendingAudio, setIsSendingAudio] = useState(false)
  const [sendProgress, setSendProgress] = useState(0)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState("")

  const scrollViewRef = useRef(null)
  const appState = useRef(AppState.currentState)
  const dataListenerRef = useRef(null)
  const connectionListenerRef = useRef(null)
  const readIntervalRef = useRef(null)
  const messageBufferRef = useRef("")
  const audioRecorderPlayer = useRef(new AudioRecorderPlayer())
  const isTranscribingRef = useRef(false)

  
  const ASSEMBLYAI_API_KEY = "942840451dd84ea6bd50903d7250f566"

  const logMessage = (msg) => {
    console.log(msg)
    if (Platform.OS === "android") {
      ToastAndroid.show(msg, ToastAndroid.SHORT)
    }
  }

  useEffect(() => {
    const initBluetooth = async () => {
      try {
        const enabled = await RNBluetoothClassic.isBluetoothEnabled()
        if (!enabled) {
          addMessage("Bluetooth is not enabled")
          return
        }

        if (Platform.OS === "android") {
          await requestPermissions()
        }

        await fetchBondedDevices()
        setupEventListeners()
      } catch (error) {
        console.error("Bluetooth initialization error:", error)
        addMessage(`Bluetooth error: ${error.message}`)
      }
    }

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        initBluetooth()
      }
      appState.current = nextAppState
    })

    initBluetooth()

    return () => {
      subscription.remove()
      cleanupConnection()
      stopRecording()
      stopPlayback()
    }
  }, [])

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true })
    }
  }, [messages])

  const setupEventListeners = () => {
    try {
      cleanupListeners()

      const BTEventEmitter = new NativeEventEmitter(NativeModules.RNBluetoothClassic)

      connectionListenerRef.current = BTEventEmitter.addListener(
        RNBluetoothClassic.BLUETOOTH_DEVICE_DISCONNECTED,
        (event) => {
          logMessage("Device disconnected event received")
          if (connectedDevice) {
            addMessage(`Disconnected from ${connectedDevice.name}`)
            setConnectedDevice(null)
            cleanupConnection()
          }
        },
      )

      dataListenerRef.current = BTEventEmitter.addListener(RNBluetoothClassic.BLUETOOTH_DATA_RECEIVED, (event) => {
        if (event && event.data) {
          logMessage("Data received: " + event.data.substring(0, 50) + (event.data.length > 50 ? "..." : ""))
          processIncomingData(event.data)
        }
      })

      logMessage("Event listeners set up successfully")
    } catch (error) {
      console.error("Error setting up event listeners:", error)
      logMessage("Error setting up listeners: " + error.message)
    }
  }

  const processIncomingData = (data) => {
    if (!data) return

    if (data.startsWith("TEXT:")) {
      
      const textMessage = data.substring("TEXT:".length).trim()
      const timestamp = new Date().toLocaleTimeString()
      addMessage(`Desktop [${timestamp}]: ${textMessage}`)
      return
    }

    if (data.startsWith("TRANSCRIPTION:")) {
      
      const transcription = data.substring("TRANSCRIPTION:".length).trim()
      addMessage(`Desktop Transcription: ${transcription}`)
      return
    }

    messageBufferRef.current += data

    let buffer = messageBufferRef.current
    let newlineIndex = buffer.indexOf("\n")

    while (newlineIndex !== -1) {
      const completeMessage = buffer.substring(0, newlineIndex).trim()
      buffer = buffer.substring(newlineIndex + 1)

      if (completeMessage) {
        addMessage(`Desktop: ${completeMessage}`)
      }

      newlineIndex = buffer.indexOf("\n")
    }

    messageBufferRef.current = buffer

    if (buffer.length > 0) {
      setTimeout(() => {
        if (messageBufferRef.current === buffer) {
          addMessage(`Desktop: ${buffer.trim()}`)
          messageBufferRef.current = ""
        }
      }, 1000)
    }
  }

  const cleanupListeners = () => {
    if (dataListenerRef.current) {
      dataListenerRef.current.remove()
      dataListenerRef.current = null
    }

    if (connectionListenerRef.current) {
      connectionListenerRef.current.remove()
      connectionListenerRef.current = null
    }
  }

  const cleanupConnection = () => {
    if (readIntervalRef.current) {
      clearInterval(readIntervalRef.current)
      readIntervalRef.current = null
    }

    if (connectedDevice) {
      disconnectDevice()
    }

    cleanupListeners()
    messageBufferRef.current = ""
  }

  const requestPermissions = async () => {
    try {
      if (Platform.OS !== "android") return true

      if (Number.parseInt(Platform.Version, 10) >= 31) {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]

        const granted = await PermissionsAndroid.requestMultiple(permissions)

        return (
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED &&
          granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED
        )
      } else if (Number.parseInt(Platform.Version, 10) >= 29) {
        const locationGranted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)
        const audioGranted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)

        return (
          locationGranted === PermissionsAndroid.RESULTS.GRANTED &&
          audioGranted === PermissionsAndroid.RESULTS.GRANTED
        )
      } else {
        const locationGranted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)
        const audioGranted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)

        return (
          locationGranted === PermissionsAndroid.RESULTS.GRANTED &&
          audioGranted === PermissionsAndroid.RESULTS.GRANTED
        )
      }
    } catch (error) {
      console.error("Permission request error:", error)
      return false
    }
  }

  const fetchBondedDevices = async () => {
    try {
      const bondedDevices = await RNBluetoothClassic.getBondedDevices()
      setAvailableDevices(bondedDevices)
      return bondedDevices
    } catch (error) {
      console.error("Error fetching bonded devices:", error)
      addMessage(`Error fetching devices: ${error.message}`)
      return []
    }
  }

  const scanDevices = async () => {
    if (isScanning) return

    try {
      const hasPermission = await requestPermissions()
      if (!hasPermission) {
        Alert.alert("Permission Required", "Bluetooth scanning requires location permission")
        return
      }

      setIsScanning(true)
      addMessage("Scanning for devices...")

      const bondedDevices = await fetchBondedDevices()

      try {
        if (typeof RNBluetoothClassic.startDiscovery === "function") {
          const discovered = await RNBluetoothClassic.startDiscovery()
          const allDevices = [...bondedDevices]

          discovered.forEach((device) => {
            if (!allDevices.some((d) => d.address === device.address)) {
              allDevices.push(device)
            }
          })

          setAvailableDevices(allDevices)
          addMessage(`Found ${allDevices.length} devices`)
        } else {
          addMessage(`Found ${bondedDevices.length} paired devices`)
        }
      } catch (error) {
        console.warn("Discovery error:", error)
        addMessage("Using paired devices only.")
      }
    } catch (error) {
      Alert.alert("Scan Failed", "Could not scan for devices")
      console.error("Scan error:", error)
    } finally {
      setIsScanning(false)
    }
  }

  const connectDevice = async (device) => {
    try {
      cleanupConnection()

      addMessage(`Connecting to ${device.name}...`)

      const connected = await RNBluetoothClassic.connectToDevice(device.address, {
        UUID: "00001101-0000-1000-8000-00805F9B34FB",
      })

      if (connected) {
        setConnectedDevice(device)
        addMessage(`Connected to ${device.name}`)

        setupEventListeners()
        startPollingForData(device)
      } else {
        addMessage(`Failed to connect to ${device.name}`)
      }
    } catch (error) {
      Alert.alert("Connection Failed", `Could not connect to ${device.name}`)
      console.error("Connection error:", error)
      addMessage(`Connection error: ${error.message}`)
    }
  }

  const startPollingForData = (device) => {
    if (readIntervalRef.current) {
      clearInterval(readIntervalRef.current)
    }

    readIntervalRef.current = setInterval(async () => {
      try {
        if (!device) return

        if (device && typeof device.read === "function") {
          const data = await device.read()
          if (data && data.trim()) {
            processIncomingData(data)
          }
        } else if (typeof RNBluetoothClassic.readFromDevice === "function") {
          const data = await RNBluetoothClassic.readFromDevice(device.address)
          if (data && data.trim()) {
            processIncomingData(data)
          }
        }
      } catch (error) {
        
        console.log("Polling read error:", error)
      }
    }, 300)
  }

  const disconnectDevice = async () => {
    try {
      if (readIntervalRef.current) {
        clearInterval(readIntervalRef.current)
        readIntervalRef.current = null
      }

      if (connectedDevice) {
        try {
          await RNBluetoothClassic.disconnectFromDevice(connectedDevice.address)
        } catch (error) {
          console.error("Error during disconnect:", error)
        }
        addMessage(`Disconnected from ${connectedDevice.name}`)
      }
    } catch (error) {
      console.error("Disconnect error:", error)
    } finally {
      setConnectedDevice(null)
    }
  }

  const sendMessage = async () => {
    if (!connectedDevice || !message.trim()) return

    try {
      const messageToSend = message.trim() + "\n"
      logMessage(`Attempting to send: ${messageToSend}`)

      let success = false

      try {
        if (connectedDevice && typeof connectedDevice.write === "function") {
          success = await connectedDevice.write(messageToSend)
          logMessage(`device.write result: ${success}`)
        }
      } catch (error) {
        logMessage(`device.write error: ${error.message}`)
      }

      if (!success) {
        try {
          if (typeof RNBluetoothClassic.writeToDevice === "function") {
            success = await RNBluetoothClassic.writeToDevice(connectedDevice.address, messageToSend)
            logMessage(`writeToDevice result: ${success}`)
          }
        } catch (error) {
          logMessage(`writeToDevice error: ${error.message}`)
        }
      }

      if (!success) {
        try {
          if (typeof RNBluetoothClassic.write === "function") {
            success = await RNBluetoothClassic.write(messageToSend)
            logMessage(`write result: ${success}`)
          }
        } catch (error) {
          logMessage(`write error: ${error.message}`)
        }
      }

      if (success) {
        addMessage(`You: ${message.trim()}`)
        setMessage("")
      } else {
        addMessage("Failed to send message. Please try again.")
      }
    } catch (error) {
      Alert.alert("Error", "Failed to send message")
      addMessage(`Send error: ${error.message}`)
    }
  }

  const addMessage = (text) => {
    setMessages((prev) => [...prev, text])
  }

  const transcribeAudio = async (audioFilePath) => {
    try {
      setIsTranscribing(true)
      isTranscribingRef.current = true
      setTranscript("")

      const fileData = await RNFS.readFile(audioFilePath, "base64")
      const audioBuffer = Buffer.from(fileData, "base64")

      logMessage("Uploading audio to AssemblyAI...")
      const uploadRes = await axios({
        method: "post",
        url: "https://api.assemblyai.com/v2/upload",
        headers: {
          authorization: ASSEMBLYAI_API_KEY,
          "Content-Type": "application/octet-stream",
        },
        data: audioBuffer,
      })

      const uploadUrl = uploadRes.data.upload_url
      logMessage("Audio uploaded successfully. Starting transcription...")

      const transcriptRes = await axios.post(
        "https://api.assemblyai.com/v2/transcript",
        {
          audio_url: uploadUrl,
        },
        {
          headers: {
            authorization: ASSEMBLYAI_API_KEY,
          },
        },
      )

      const transcriptId = transcriptRes.data.id
      logMessage(`Transcription started with ID: ${transcriptId}`)

      let completed = false
      while (!completed) {
        const pollingRes = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: {
            authorization: ASSEMBLYAI_API_KEY,
          },
        })

        if (pollingRes.data.status === "completed") {
          const transcribedText = pollingRes.data.text
          setTranscript(transcribedText)
          logMessage("Transcription completed successfully")
          addMessage(`Transcription: ${transcribedText}`)

          if (connectedDevice && transcribedText) {
            sendTranscriptionToDesktop(transcribedText)
          }

          completed = true
        } else if (pollingRes.data.status === "error") {
          logMessage("Error during transcription")
          addMessage("Error during transcription")
          completed = true
        } else {
          logMessage("Transcribing...")
          await new Promise((res) => setTimeout(res, 3000))
        }
      }
    } catch (error) {
      console.error("Transcription error:", error)
      logMessage(`Transcription error: ${error.message}`)
      addMessage("Failed to transcribe audio")
    } finally {
      setIsTranscribing(false)
      isTranscribingRef.current = false
    }
  }

  const sendTranscriptionToDesktop = async (transcribedText) => {
    if (!connectedDevice || !transcribedText) return

    try {
      const messageToSend = `TRANSCRIPTION: ${transcribedText}\n`
      logMessage("Sending transcription to desktop...")

      let success = false

      try {
        if (connectedDevice && typeof connectedDevice.write === "function") {
          success = await connectedDevice.write(messageToSend)
        }
      } catch (error) {
        logMessage(`Error sending transcription: ${error.message}`)
      }

      if (!success) {
        try {
          if (typeof RNBluetoothClassic.writeToDevice === "function") {
            success = await RNBluetoothClassic.writeToDevice(connectedDevice.address, messageToSend)
          }
        } catch (error) {
          logMessage(`Error sending transcription: ${error.message}`)
        }
      }

      if (success) {
        logMessage("Transcription sent to desktop successfully")
      } else {
        logMessage("Failed to send transcription")
        addMessage("Failed to send transcription to desktop")
      }
    } catch (error) {
      console.error("Send transcription error:", error)
      logMessage(`Send transcription error: ${error.message}`)
    }
  }

  const startRecording = async () => {
    try {
      if (isRecording) return

      const hasPermission = await requestPermissions()
      if (!hasPermission) {
        Alert.alert("Permission Required", "Recording requires audio permission")
        return
      }

      const audioPath = Platform.select({
        ios: `${RNFS.DocumentDirectoryPath}/recording_${Date.now()}.wav`,
        android: `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/recording_${Date.now()}.wav`,
      })

      const result = await audioRecorderPlayer.current.startRecorder(audioPath)

      audioRecorderPlayer.current.addRecordBackListener((e) => {
        setRecordingTime(e.currentPosition)
        console.log("Recording...", e.currentPosition)
      })

      setIsRecording(true)
      setCurrentAudioFile(result)
      addMessage("Recording voice message...")
      logMessage("Recording started at: " + result)
    } catch (error) {
      console.error("Recording error:", error)
      logMessage(`Recording error: ${error.message}`)
      Alert.alert("Recording Error", error.message)
      setIsRecording(false)
    }
  }

  const stopRecording = async () => {
    try {
      if (!isRecording) return

      const result = await audioRecorderPlayer.current.stopRecorder()
      audioRecorderPlayer.current.removeRecordBackListener()

      setIsRecording(false)
      setRecordingTime(0)
      addMessage("Voice message recorded")
      logMessage("Recording stopped: " + result)

      if (result) {
        setCurrentAudioFile(result)
        transcribeAudio(result)

        Alert.alert("Voice Message", "Send voice message?", [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Send",
            onPress: () => sendVoiceMessage(result),
          },
        ])
      }
    } catch (error) {
      console.error("Stop recording error:", error)
      logMessage(`Stop recording error: ${error.message}`)
      setIsRecording(false)
      setRecordingTime(0)
    }
  }

  const playAudio = async (filePath) => {
    try {
      if (isPlaying) {
        await stopPlayback()
        return
      }

      const exists = await RNFS.exists(filePath)
      if (!exists) {
        Alert.alert("Error", "Audio file not found")
        return
      }

      await audioRecorderPlayer.current.startPlayer(filePath)

      audioRecorderPlayer.current.addPlayBackListener((e) => {
        if (e.currentPosition === e.duration) {
          stopPlayback()
        }
      })

      setIsPlaying(true)
    } catch (error) {
      console.error("Playback error:", error)
      logMessage(`Playback error: ${error.message}`)
      Alert.alert("Playback Error", error.message)
    }
  }

  const stopPlayback = async () => {
    try {
      await audioRecorderPlayer.current.stopPlayer()
      audioRecorderPlayer.current.removePlayBackListener()
      setIsPlaying(false)
    } catch (error) {
      console.error("Stop playback error:", error)
      logMessage(`Stop playback error: ${error.message}`)
    }
  }

  const sendVoiceMessage = async (audioFilePath) => {
    if (!connectedDevice) {
      Alert.alert("Error", "No device connected")
      return
    }

    try {
      setIsSendingAudio(true)
      setSendProgress(0)
      addMessage("Sending voice message...")

      const fileExists = await RNFS.exists(audioFilePath)
      if (!fileExists) {
        throw new Error("Audio file not found")
      }

      const fileStats = await RNFS.stat(audioFilePath)
      const fileSize = fileStats.size

      logMessage(`Audio file size: ${fileSize} bytes`)

      const fileContent = await RNFS.readFile(audioFilePath, "base64")

      const header = `AUDIO:${fileContent.length}\n`

      let success = false
      try {
        if (connectedDevice && typeof connectedDevice.write === "function") {
          success = await connectedDevice.write(header)
          logMessage(`Header sent successfully: ${success}`)
        }
      } catch (error) {
        logMessage(`Header write error: ${error.message}`)
      }

      if (!success) {
        try {
          if (typeof RNBluetoothClassic.writeToDevice === "function") {
            success = await RNBluetoothClassic.writeToDevice(connectedDevice.address, header)
            logMessage(`Header sent via writeToDevice: ${success}`)
          }
        } catch (error) {
          logMessage(`Header writeToDevice error: ${error.message}`)
        }
      }

      if (success) {
        const chunkSize = 512
        const totalChunks = Math.ceil(fileContent.length / chunkSize)

        for (let i = 0; i < fileContent.length; i += chunkSize) {
          const chunk = fileContent.substring(i, Math.min(i + chunkSize, fileContent.length))

          await new Promise((resolve) => setTimeout(resolve, 100))

          try {
            let chunkSuccess = false

            if (connectedDevice && typeof connectedDevice.write === "function") {
              chunkSuccess = await connectedDevice.write(chunk)
            }

            if (!chunkSuccess && typeof RNBluetoothClassic.writeToDevice === "function") {
              chunkSuccess = await RNBluetoothClassic.writeToDevice(connectedDevice.address, chunk)
            }

            const progress = Math.min(100, Math.round(((i + chunk.length) / fileContent.length) * 100))
            setSendProgress(progress)

            if (i % (chunkSize * 10) === 0 || i + chunk.length >= fileContent.length) {
              logMessage(`Sent ${i + chunk.length}/${fileContent.length} bytes (${progress}%)`)
            }
          } catch (error) {
            logMessage(`Chunk write error: ${error.message}`)
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 500))

        addMessage("You: [Voice Message]")
        logMessage("Voice message sent successfully")
      } else {
        throw new Error("Failed to send audio header")
      }
    } catch (error) {
      console.error("Send voice message error:", error)
      logMessage(`Send voice message error: ${error.message}`)
      Alert.alert("Error", "Failed to send voice message")
    } finally {
      setIsSendingAudio(false)
      setSendProgress(0)
    }
  }

  const formatTime = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  const renderVoiceMessageControls = () => {
    if (!connectedDevice) return null

    return (
      <View style={styles.voiceControls}>
        <TouchableOpacity
          style={[
            styles.recordButton,
            isRecording ? styles.recordingButton : null,
            isSendingAudio || isTranscribing ? styles.disabledButton : null,
          ]}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={isSendingAudio || isTranscribing}
        >
          <Text style={styles.recordButtonText}>
            {isRecording
              ? `Stop Recording (${formatTime(recordingTime)})`
              : isSendingAudio
                ? "Sending Audio..."
                : isTranscribing
                  ? "Transcribing..."
                  : "Record Voice"}
          </Text>
        </TouchableOpacity>

        {isSendingAudio && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${sendProgress}%` }]} />
            <Text style={styles.progressText}>{sendProgress}%</Text>
          </View>
        )}

        {isTranscribing && (
          <View style={styles.transcribingContainer}>
            <ActivityIndicator size="small" color="#007bff" />
            <Text style={styles.transcribingText}>Transcribing audio...</Text>
          </View>
        )}

        {transcript && (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptTitle}>Transcription:</Text>
            <Text style={styles.transcriptText}>{transcript}</Text>
          </View>
        )}

        {currentAudioFile && !isRecording && !isSendingAudio && !isTranscribing && (
          <TouchableOpacity style={styles.playButton} onPress={() => playAudio(currentAudioFile)}>
            <Text style={styles.playButtonText}>{isPlaying ? "Stop Playback" : "Play Last Recording"}</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Bluetooth Chat</Text>

      <View style={styles.statusContainer}>
        {connectedDevice ? (
          <Text style={styles.connectedStatus}>Connected to: {connectedDevice.name}</Text>
        ) : (
          <Text style={styles.disconnectedStatus}>Not connected</Text>
        )}
      </View>

      <ScrollView style={styles.messagesContainer} ref={scrollViewRef} contentContainerStyle={{ paddingBottom: 20 }}>
        {messages.map((msg, index) => (
          <Text key={index} style={styles.message}>
            {msg}
          </Text>
        ))}
      </ScrollView>

      {connectedDevice ? (
        <View>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder="Type a message..."
              onSubmitEditing={sendMessage}
              multiline
              blurOnSubmit={false}
              editable={!isSendingAudio && !isTranscribing}
            />
            <Button title="Send" onPress={sendMessage} disabled={isSendingAudio || isTranscribing} />
          </View>
          {renderVoiceMessageControls()}
        </View>
      ) : (
        <Button title={isScanning ? "Scanning..." : "Scan for Devices"} onPress={scanDevices} disabled={isScanning} />
      )}

      <View style={styles.devicesContainer}>
        <Text style={styles.devicesTitle}>Available Devices:</Text>
        {availableDevices.length > 0 ? (
          availableDevices.map((device) => (
            <Text
              key={device.address}
              style={[
                styles.deviceItem,
                connectedDevice && connectedDevice.address === device.address && styles.connectedDevice,
              ]}
              onPress={() => !connectedDevice && connectDevice(device)}
            >
              {device.name || "Unknown"} ({device.address})
              {connectedDevice && connectedDevice.address === device.address ? " ✓" : ""}
            </Text>
          ))
        ) : (
          <Text style={styles.noDevices}>No devices found. Try scanning.</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f5f5f5",
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
    color: "#333",
  },
  statusContainer: {
    marginBottom: 15,
  },
  connectedStatus: {
    color: "green",
    textAlign: "center",
    fontWeight: "bold",
  },
  disconnectedStatus: {
    color: "red",
    textAlign: "center",
  },
  messagesContainer: {
    flex: 1,
    marginBottom: 15,
    backgroundColor: "white",
    borderRadius: 8,
    padding: 10,
  },
  message: {
    padding: 8,
    marginVertical: 4,
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  inputContainer: {
    flexDirection: "row",
    marginBottom: 15,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginRight: 10,
    backgroundColor: "white",
    fontSize: 16,
  },
  devicesContainer: {
    padding: 15,
    backgroundColor: "#e9e9e9",
    borderRadius: 8,
  },
  devicesTitle: {
    fontWeight: "bold",
    marginBottom: 10,
    fontSize: 16,
  },
  deviceItem: {
    padding: 10,
    fontSize: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  connectedDevice: {
    color: "green",
    fontWeight: "bold",
  },
  noDevices: {
    fontStyle: "italic",
    color: "#666",
    textAlign: "center",
    padding: 10,
  },
  voiceControls: {
    marginBottom: 15,
    alignItems: "center",
  },
  recordButton: {
    backgroundColor: "#007bff",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 25,
    width: "80%",
    alignItems: "center",
    marginBottom: 10,
  },
  recordingButton: {
    backgroundColor: "#dc3545",
  },
  disabledButton: {
    backgroundColor: "#6c757d",
    opacity: 0.7,
  },
  recordButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  playButton: {
    backgroundColor: "#28a745",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 25,
    width: "80%",
    alignItems: "center",
  },
  playButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  progressContainer: {
    width: "80%",
    height: 20,
    backgroundColor: "#e9ecef",
    borderRadius: 10,
    marginBottom: 10,
    overflow: "hidden",
    position: "relative",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#007bff",
    borderRadius: 10,
  },
  progressText: {
    position: "absolute",
    width: "100%",
    textAlign: "center",
    color: "#000",
    fontWeight: "bold",
    fontSize: 12,
    lineHeight: 20,
  },
  transcribingContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: "#e9ecef",
    padding: 10,
    borderRadius: 8,
    width: "80%",
  },
  transcribingText: {
    marginLeft: 10,
    color: "#007bff",
    fontWeight: "500",
  },
  transcriptContainer: {
    width: "80%",
    backgroundColor: "#f8f9fa",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#28a745",
  },
  transcriptTitle: {
    fontWeight: "bold",
    marginBottom: 5,
  },
  transcriptText: {
    fontSize: 14,
  },
})

export default App