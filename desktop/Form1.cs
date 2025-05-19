using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using InTheHand.Net.Sockets;
using InTheHand.Net;
using InTheHand.Net.Bluetooth;
using System.Net.Sockets;
using System.Linq;
using System.Threading;
using NAudio.Wave;
using System.Drawing;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;
using Newtonsoft.Json;

namespace BluetoothChatDesktop
{
    public partial class Form1 : Form
    {
        private BluetoothClient bluetoothClient;
        private List<BluetoothDeviceInfo> devices;
        private NetworkStream bluetoothStream;
        private bool isConnected = false;
        private BluetoothDeviceInfo connectedDevice;
        private BluetoothListener bluetoothListener;
        private CancellationTokenSource cancellationTokenSource;

       
        private WaveInEvent waveIn;
        private string tempAudioFile;
        private bool isRecording = false;
        private MemoryStream audioMemoryStream;
        private WaveFormat waveFormat;

      
        private bool debugMode = true;

       
        private bool isTranscribing = false;
        private string currentTranscription = "";
        private readonly string assemblyAIApiKey = "942840451dd84ea6bd50903d7250f566";
        private readonly HttpClient httpClient = new HttpClient();

        public Form1()
        {
            InitializeComponent();
            this.FormClosing += Form1_FormClosing;
            devices = new List<BluetoothDeviceInfo>();
            messageTextBox.KeyDown += MessageTextBox_KeyDown;
            cancellationTokenSource = new CancellationTokenSource();

                        waveFormat = new WaveFormat(8000, 16, 1);

                        string tempPath = Path.Combine(Path.GetTempPath(), "BluetoothChatTemp");
            if (!Directory.Exists(tempPath))
            {
                Directory.CreateDirectory(tempPath);
            }

                        tempAudioFile = Path.Combine(tempPath, $"temp_audio_{DateTime.Now.Ticks}.wav");

                        httpClient.BaseAddress = new Uri("https://api.assemblyai.com/v2/");
            httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(assemblyAIApiKey);
            httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                        if (debugMode)
            {
                string logPath = Path.Combine(tempPath, "bluetooth_chat_log.txt");
                Debug.Listeners.Add(new TextWriterTraceListener(logPath));
                Debug.AutoFlush = true;
                Debug.WriteLine($"Application started at {DateTime.Now}");
                Debug.WriteLine($"Temp audio file: {tempAudioFile}");
            }
        }

        private void MessageTextBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter && !e.Shift)
            {
                e.SuppressKeyPress = true;
                sendButton.PerformClick();
            }
        }

        private async void Form1_Load(object sender, EventArgs e)
        {
            await RefreshDevicesAsync();
            StartBluetoothListener();
        }

        private void Form1_FormClosing(object sender, FormClosingEventArgs e)
        {
            cancellationTokenSource.Cancel();
            try
            {
                bluetoothListener?.Stop();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error stopping listener: {ex.Message}");
            }

            Disconnect();
            StopRecording();
            httpClient.Dispose();

            foreach (TraceListener listener in Debug.Listeners)
            {
                try
                {
                    listener.Flush();
                    listener.Close();
                }
                catch { }
            }
        }

        private void StartBluetoothListener()
        {
            try
            {
                Guid serviceGuid = new Guid("00001101-0000-1000-8000-00805F9B34FB");
                bluetoothListener = new BluetoothListener(serviceGuid);
                bluetoothListener.Start();
                UpdateStatus("Listening for connections...");
                Task.Run(async () => await AcceptConnectionsAsync(cancellationTokenSource.Token));
            }
            catch (Exception ex)
            {
                ShowError($"Failed to start Bluetooth listener: {ex.Message}");
                UpdateStatus("Listener failed to start");
            }
        }

        private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    BluetoothClient client = await Task.Run(() => bluetoothListener.AcceptBluetoothClient(), cancellationToken);

                    if (isConnected)
                    {
                        client.Close();
                        continue;
                    }

                    string deviceName = "Mobile Device";

                    this.Invoke((MethodInvoker)delegate
                    {
                        bluetoothClient = client;
                        bluetoothStream = client.GetStream();
                        isConnected = true;
                        connectButton.Text = "Disconnect";
                        UpdateStatus($"Connected to {deviceName}");
                        AppendMessage($"Connected to {deviceName}");
                    });

                    await ListenForData();

                    this.Invoke((MethodInvoker)delegate
                    {
                        Disconnect();
                    });
                }
            }
            catch (OperationCanceledException)
            {
                            }
            catch (Exception ex)
            {
                this.Invoke((MethodInvoker)delegate
                {
                    ShowError($"Listener error: {ex.Message}");
                    UpdateStatus("Listener error");
                });
            }
        }

        private async Task RefreshDevicesAsync()
        {
            devicesListBox.Items.Clear();
            UpdateStatus("Discovering devices...");
            Cursor.Current = Cursors.WaitCursor;

            try
            {
                if (bluetoothClient != null && !isConnected)
                {
                    bluetoothClient.Close();
                    bluetoothClient = null;
                }

                if (bluetoothClient == null)
                {
                    bluetoothClient = new BluetoothClient();
                }

                devices.Clear();
                BluetoothDeviceInfo[] discoveredDevices = Array.Empty<BluetoothDeviceInfo>();

                await Task.Run(() => {
                    try
                    {
                        var deviceCollection = bluetoothClient.DiscoverDevices();
                        discoveredDevices = deviceCollection.ToArray();
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"Discovery error: {ex.Message}");
                    }
                });

                foreach (var device in discoveredDevices)
                {
                    devices.Add(device);
                    devicesListBox.Items.Add($"{device.DeviceName} ({device.DeviceAddress}) - {(device.Authenticated ? "Paired" : "Not Paired")}");
                }

                UpdateStatus($"Found {devices.Count} devices");
            }
            catch (Exception ex)
            {
                ShowError($"Error discovering devices: {ex.Message}");
                UpdateStatus("Discovery failed");
            }
            finally
            {
                Cursor.Current = Cursors.Default;
            }
        }

        private async void connectButton_Click(object sender, EventArgs e)
        {
            if (isConnected)
            {
                Disconnect();
                return;
            }

            if (devicesListBox.SelectedIndex < 0 || devicesListBox.SelectedIndex >= devices.Count)
            {
                ShowError("Please select a device to connect to");
                return;
            }

            var selectedDevice = devices[devicesListBox.SelectedIndex];
            await ConnectToDeviceAsync(selectedDevice);
        }

        private async Task ConnectToDeviceAsync(BluetoothDeviceInfo device)
        {
            try
            {
                UpdateStatus($"Connecting to {device.DeviceName}...");
                Cursor.Current = Cursors.WaitCursor;

                if (bluetoothClient != null && !isConnected)
                {
                    bluetoothClient.Close();
                    bluetoothClient = null;
                }

                if (bluetoothClient == null)
                {
                    bluetoothClient = new BluetoothClient();
                }

                Guid serviceGuid = new Guid("00001101-0000-1000-8000-00805F9B34FB");

                await Task.Run(() => {
                    bluetoothClient.Connect(device.DeviceAddress, serviceGuid);
                });

                bluetoothStream = bluetoothClient.GetStream();
                isConnected = true;
                connectedDevice = device;
                connectButton.Text = "Disconnect";
                UpdateStatus($"Connected to {device.DeviceName}");
                AppendMessage($"Connected to {device.DeviceName}");

                await ListenForData();
                Disconnect();
            }
            catch (Exception ex)
            {
                ShowError($"Connection failed: {ex.Message}");
                UpdateStatus("Connection failed");
                Disconnect();
            }
            finally
            {
                Cursor.Current = Cursors.Default;
            }
        }

        private void Disconnect()
        {
            try
            {
                if (bluetoothStream != null)
                {
                    bluetoothStream.Close();
                    bluetoothStream = null;
                }

                if (bluetoothClient != null)
                {
                    bluetoothClient.Close();
                    bluetoothClient = null;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error during disconnect: {ex.Message}");
            }
            finally
            {
                isConnected = false;
                connectedDevice = null;
                connectButton.Text = "Connect";
                UpdateStatus("Disconnected");
            }
        }

        private async Task ListenForData()
        {
            if (bluetoothStream == null) return;

            byte[] buffer = new byte[4096];
            StringBuilder messageBuilder = new StringBuilder();

            try
            {
                while (isConnected && bluetoothStream != null)
                {
                    if (!bluetoothStream.CanRead)
                    {
                        await Task.Delay(100);
                        continue;
                    }

                    int bytesRead = 0;

                    try
                    {
                        bytesRead = await bluetoothStream.ReadAsync(buffer, 0, buffer.Length, cancellationTokenSource.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"Read error: {ex.Message}");
                        break;
                    }

                    if (bytesRead == 0)
                    {
                        break;
                    }

                    string data = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                    Debug.WriteLine($"Received data: {data.Length} bytes");

                    if (data.StartsWith("TRANSCRIPTION:"))
                    {
                        ProcessTranscriptionMessage(data);
                    }
                    else if (data.StartsWith("TEXT:"))
                    {
                        ProcessTextMessage(data);
                    }
                    else if (data.StartsWith("AUDIO:"))
                    {
                                                continue;
                    }
                    else
                    {
                        ProcessTextData(data, messageBuilder);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Listen error: {ex.Message}");
            }
        }

        private void ProcessTranscriptionMessage(string data)
        {
            try
            {
                string transcription = data.Substring("TRANSCRIPTION:".Length).Trim();
                this.Invoke((MethodInvoker)delegate
                {
                    AppendMessage($"Mobile: {transcription}");
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error processing transcription message: {ex.Message}");
            }
        }

        private void ProcessTextMessage(string data)
        {
            try
            {
                string message = data.Substring("TEXT:".Length).Trim();
                this.Invoke((MethodInvoker)delegate
                {
                    AppendMessage($"Mobile: {message}");
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error processing text message: {ex.Message}");
            }
        }

        private void ProcessTextData(string data, StringBuilder messageBuilder)
        {
            messageBuilder.Append(data);
            string messages = messageBuilder.ToString();
            int lastNewlineIndex = messages.LastIndexOf('\n');

            if (lastNewlineIndex >= 0)
            {
                string completeMessages = messages.Substring(0, lastNewlineIndex);

                if (lastNewlineIndex < messages.Length - 1)
                {
                    messageBuilder.Clear();
                    messageBuilder.Append(messages.Substring(lastNewlineIndex + 1));
                }
                else
                {
                    messageBuilder.Clear();
                }

                string[] messageLines = completeMessages.Split('\n');
                foreach (string line in messageLines)
                {
                    if (!string.IsNullOrWhiteSpace(line))
                    {
                        this.Invoke((MethodInvoker)delegate
                        {
                                                        if (line.Trim().StartsWith("TRANSCRIPTION:"))
                            {
                                AppendMessage($"Mobile: {line.Trim().Substring("TRANSCRIPTION:".Length).Trim()}");
                            }
                        });
                    }
                }
            }
        }

        private async Task TranscribeAudioAsync(string audioFilePath)
        {
            if (isTranscribing) return;

            try
            {
                this.Invoke((MethodInvoker)delegate
                {
                    isTranscribing = true;
                    UpdateStatus("Transcribing audio...");
                });

                var uploadUrl = await UploadAudioFile(audioFilePath);
                if (string.IsNullOrEmpty(uploadUrl))
                {
                    throw new Exception("Failed to upload audio file");
                }

                var transcriptId = await StartTranscription(uploadUrl);
                if (string.IsNullOrEmpty(transcriptId))
                {
                    throw new Exception("Failed to start transcription");
                }

                string transcription = await PollForTranscriptionResult(transcriptId);
                if (!string.IsNullOrEmpty(transcription))
                {
                    this.Invoke((MethodInvoker)delegate
                    {
                        AppendMessage($"TRANSCRIPTION: {transcription}");
                        UpdateStatus("Transcription completed");
                        SendTextMessage(transcription);
                    });
                }
            }
            catch (Exception ex)
            {
                this.Invoke((MethodInvoker)delegate
                {
                    Debug.WriteLine($"Transcription error: {ex.Message}");
                    UpdateStatus("Transcription failed");
                });
            }
            finally
            {
                this.Invoke((MethodInvoker)delegate
                {
                    isTranscribing = false;
                });
            }
        }

        private async Task<string> UploadAudioFile(string filePath)
        {
            try
            {
                using (var fileStream = File.OpenRead(filePath))
                using (var content = new StreamContent(fileStream))
                {
                    content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                    var response = await httpClient.PostAsync("upload", content);

                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        var result = JsonConvert.DeserializeObject<UploadResult>(json);
                        return result?.upload_url;
                    }
                    else
                    {
                        Debug.WriteLine($"Upload failed: {response.StatusCode} - {await response.Content.ReadAsStringAsync()}");
                        return null;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Upload error: {ex.Message}");
                return null;
            }
        }

        private async Task<string> StartTranscription(string audioUrl)
        {
            try
            {
                var request = new
                {
                    audio_url = audioUrl,
                    language_code = "en_us"
                };

                var content = new StringContent(JsonConvert.SerializeObject(request), Encoding.UTF8, "application/json");
                var response = await httpClient.PostAsync("transcript", content);

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
                    var result = JsonConvert.DeserializeObject<TranscriptionResult>(json);
                    return result?.id;
                }
                else
                {
                    Debug.WriteLine($"Transcription start failed: {response.StatusCode} - {await response.Content.ReadAsStringAsync()}");
                    return null;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Transcription start error: {ex.Message}");
                return null;
            }
        }

        private async Task<string> PollForTranscriptionResult(string transcriptId)
        {
            try
            {
                string status = "queued";
                string transcription = null;
                int attempts = 0;
                const int maxAttempts = 30;

                while (status != "completed" && attempts < maxAttempts && !cancellationTokenSource.IsCancellationRequested)
                {
                    attempts++;
                    await Task.Delay(3000, cancellationTokenSource.Token);

                    var response = await httpClient.GetAsync($"transcript/{transcriptId}");
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        var result = JsonConvert.DeserializeObject<TranscriptionStatusResult>(json);

                        status = result?.status?.ToLower() ?? "error";
                        transcription = result?.text;

                        if (status == "completed")
                        {
                            break;
                        }
                        else if (status == "error")
                        {
                            Debug.WriteLine($"Transcription error: {result?.error}");
                            break;
                        }

                        this.Invoke((MethodInvoker)delegate
                        {
                            UpdateStatus($"Transcribing... ({attempts * 3}s)");
                        });
                    }
                    else
                    {
                        Debug.WriteLine($"Status check failed: {response.StatusCode} - {await response.Content.ReadAsStringAsync()}");
                        break;
                    }
                }

                return transcription;
            }
            catch (OperationCanceledException)
            {
                Debug.WriteLine("Transcription polling cancelled");
                return null;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Polling error: {ex.Message}");
                return null;
            }
        }

        private void SendTextMessage(string text)
        {
            try
            {
                string message = $"TEXT: {text}\n";
                byte[] buffer = Encoding.UTF8.GetBytes(message);
                bluetoothStream.Write(buffer, 0, buffer.Length);
                bluetoothStream.Flush();
                Debug.WriteLine("Text message sent to mobile device");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error sending text message: {ex.Message}");
            }
        }

        private void sendButton_Click(object sender, EventArgs e)
        {
            if (!isConnected || bluetoothStream == null)
            {
                ShowError("Not connected to any device");
                return;
            }

            string message = messageTextBox.Text.Trim();
            if (string.IsNullOrEmpty(message))
            {
                return;
            }

            try
            {
                string timestamp = DateTime.Now.ToString("HH:mm:ss");
                string formattedMessage = $"TEXT: {message}\n";
                byte[] buffer = Encoding.UTF8.GetBytes(formattedMessage);
                bluetoothStream.Write(buffer, 0, buffer.Length);
                bluetoothStream.Flush();
                AppendMessage($"You [{timestamp}]: {message}");
                messageTextBox.Clear();
            }
            catch (Exception ex)
            {
                ShowError($"Failed to send message: {ex.Message}");
                Disconnect();
            }
        }

        private void recordVoiceButton_Click(object sender, EventArgs e)
        {
            if (!isConnected)
            {
                ShowError("Not connected to any device");
                return;
            }

            if (isRecording)
            {
                StopRecording();
            }
            else
            {
                StartRecording();
            }
        }

        private void StartRecording()
        {
            try
            {
                if (isRecording) return;

                waveIn = new WaveInEvent
                {
                    WaveFormat = waveFormat,
                    BufferMilliseconds = 50
                };

                audioMemoryStream = new MemoryStream();
                WaveFileWriter writer = new WaveFileWriter(tempAudioFile, waveIn.WaveFormat);

                waveIn.DataAvailable += (s, e) =>
                {
                    writer.Write(e.Buffer, 0, e.BytesRecorded);
                    audioMemoryStream.Write(e.Buffer, 0, e.BytesRecorded);
                };

                waveIn.RecordingStopped += (s, e) =>
                {
                    writer.Dispose();
                    writer = null;
                    waveIn.Dispose();
                    waveIn = null;
                };

                waveIn.StartRecording();
                isRecording = true;
                recordVoiceButton.Text = "Stop Recording";
                UpdateStatus("Recording voice message...");
            }
            catch (Exception ex)
            {
                ShowError($"Failed to start recording: {ex.Message}");
                isRecording = false;
                recordVoiceButton.Text = "Record Voice";
            }
        }

        private void StopRecording()
        {
            if (!isRecording) return;

            try
            {
                waveIn?.StopRecording();
                isRecording = false;
                recordVoiceButton.Text = "Record Voice";
                UpdateStatus("Recording stopped");

                DialogResult result = MessageBox.Show(
                    "Do you want to transcribe this recording?",
                    "Transcribe Recording",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);

                if (result == DialogResult.Yes)
                {
                    _ = TranscribeAudioAsync(tempAudioFile);
                }
            }
            catch (Exception ex)
            {
                ShowError($"Error stopping recording: {ex.Message}");
            }
        }

        private void refreshButton_Click(object sender, EventArgs e)
        {
            RefreshDevicesAsync();
        }

        private void AppendMessage(string message)
        {
            if (chatTextBox.InvokeRequired)
            {
                chatTextBox.Invoke(new Action<string>(AppendMessage), message);
                return;
            }

            chatTextBox.AppendText(message + Environment.NewLine);
            chatTextBox.ScrollToCaret();
        }

        private void UpdateStatus(string status)
        {
            if (statusLabel.InvokeRequired)
            {
                statusLabel.Invoke(new Action<string>(UpdateStatus), status);
                return;
            }

            statusLabel.Text = $"Status: {status}";
        }

        private void ShowError(string message)
        {
            Debug.WriteLine($"ERROR: {message}");
            MessageBox.Show(message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        private class UploadResult
        {
            public string upload_url { get; set; }
        }

        private class TranscriptionResult
        {
            public string id { get; set; }
        }

        private class TranscriptionStatusResult
        {
            public string status { get; set; }
            public string text { get; set; }
            public string error { get; set; }
        }
    }
}