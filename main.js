async function initializeTensorFlow() {
    await tf.ready();
}

const queueCheckInterval = 5000;
let processingFile = false;

async function checkFileQueue() {
    if (processingFile) {
        console.log('File is being processed.');
        return;
    }

    processingFile = true;

    try {
        const response = await fetch('http://localhost:3000/file/queue');

        if (!response.ok) {
            // If the response status is not OK, handle it here
            console.error('Failed to fetch file queue. Status:', response.status);
            return;
        }

        const data = await response.json();
        const fileQueue = data.fileQueue;

        if (fileQueue.length > 0) {
            console.log('Files in the queue:', fileQueue);

            const firstFileId = fileQueue[0];
            await processFile(firstFileId);
        } else {
            console.log('No files in the queue.');
        }
    } catch (error) {
        if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            // Do nothing and return without logging anything
            return;
        } else {
            console.error('Error checking file queue:', error);
        }
    } finally {
        processingFile = false;
    }
}

async function processFile(fileId) {
    try {
        const response = await fetch(`http://localhost:3000/file/${fileId}`);
        const buffer = await response.arrayBuffer();

        const pprocOutput = await preProcessAudioFromAPI(buffer, fileId);
        console.log('File processed successfully.');

        const removeResponse = await fetch(`http://localhost:3000/process/${fileId}`, { method: 'POST' });

        if (removeResponse.ok) {
            console.log('File removed from the queue.');
        } else {
            console.error('Error removing file from the queue:', postProcessResponse.statusText);
        }
    } catch (error) {
        console.error('Error processing file:', error);
    }
}

function isServerReachable() {
    return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                resolve(xhr.status === 200);
            }
        };
        xhr.open('GET', 'http://localhost:3000/test', true);
        xhr.send();
    });
}

let onnxModelBlob = null;
let modelLoaded = false;

async function initialize() {
    const serverReachable = await isServerReachable();

    if (serverReachable) {
        showLoader("Fetching VGGish model, please wait...");

        onnxModelBlob = await fetchOnnxModelWithProgressBar();

        if (onnxModelBlob) {
            vggishModelLoaded = true;
            hideLoader();
            updateUI("VGGish model loaded");
            console.log('VGGish model loaded successfully.');
        } else {
            hideLoader();
            updateUI("Failed to fetch ONNX model");
            console.error('Failed to fetch ONNX model.');
        }

        setInterval(checkFileQueue, queueCheckInterval);
    } else {
        console.log('Server is not reachable. Refresh to retry.');
    }
}

function updateProgressBar(progress) {
    console.log(`Progress: ${progress}%`);
}

async function fetchOnnxModelWithProgressBar() {
    try {
        const progressBar = document.getElementById('progressBar');
        const loadingText = document.getElementById('loadingText');
        progressBar.style.display = 'block';

        loadingText.textContent = "Fetching VGGish model, please wait...";

        const blob = await fetchOnnxModel(progressBar);

        progressBar.value = 0;
        progressBar.style.display = 'none';

        return blob;
    } catch (error) {
        console.error('Error fetching the ONNX model:', error);
        return null;
    }
}

function hideLoader() {
    const loader = document.getElementById('loader');

    loader.style.display = 'none';
}

function showLoader(text) {
    const loader = document.getElementById('loader');
    const loadingText = document.getElementById('loadingText');

    loader.style.display = 'block';
    loadingText.textContent = text;
}

function updateUI(message) {
    const statusText = document.getElementById('statusText');

    // Update the UI with the provided message
    statusText.textContent = message;
}

const loaderStyles = `
    #vggishLoader {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.8);
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    }
`;

const styleElement = document.createElement('style');
styleElement.innerHTML = loaderStyles;
document.head.appendChild(styleElement);

let vggishModelLoaded = false;

initialize();

let audioContext;

function createAudioContext() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

function handleStartAudioContext() {
    if (!audioContext) {
        createAudioContext();
        console.log('AudioContext started.');
    } else {
        console.log('AudioContext is already started.');
    }
}

document.getElementById('startAudioContextButton').addEventListener('click', handleStartAudioContext);

async function preProcessAudioFromAPI(audioBuffer, fileId) {
    if (!audioContext) {
        console.warn('AudioContext is not started. Please click "Start Audio Context" button.');
        return { success: false, message: 'AudioContext not started' };
    }

    const audioBufferFromArray = await audioContext.decodeAudioData(audioBuffer);
    const pprocOutput = await process(audioBufferFromArray);

    const apiUrl = `http://localhost:3000/process-data/${fileId}`;
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ processedData: pprocOutput }),
    });

    if (response.ok) {
        console.log(`Processed data sent successfully to the server for fileId ${fileId}.`);
    } else {
        console.error(`Error sending processed data to the server for fileId ${fileId}:`, response.statusText);
    }
}

async function fetchOnnxModel(onProgress) {
    const modelUrl = 'https://essentia.upf.edu/models/feature-extractors/vggish/audioset-vggish-3.onnx';
    const fetchModelUrl = 'http://localhost:3000/fetch-onnx-model';

    try {
        const response = await fetch(fetchModelUrl);

        if (!response.ok) {
            throw new Error(`Failed to fetch ONNX model: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;

        while (true) {
            const { value, done } = await reader.read();

            if (done) {
                break;
            }

            chunks.push(value);
            totalBytes += value.length;

            // Update the progress bar
            const progress = (totalBytes / response.headers.get('Content-Length')) * 100;
            progressBar.value = progress;
        }

        const blob = new Blob(chunks, { type: response.headers.get('Content-Type') });
        vggishModelLoaded = true;

        return blob;
    } catch (error) {
        console.error('Error fetching the ONNX model:', error);
        return null;
    }
}

async function process(audioBuffer) {
    while (!vggishModelLoaded) {
        console.log('VGGish model is not loaded yet. Please wait.');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // const onnxModelPath = './audioset-vggish-3.onnx';
    // console.log("fetching onnx model");
    // const onnxModelBlob = await fetchOnnxModel();
    // console.log("done getting model blob");
    
    if (!onnxModelBlob) {
        console.error('Failed to fetch ONNX model.');
        return null;
    }

    const preprocessedData = await preprocess(audioBuffer);

    if (preprocessedData) {
        // const ortOutputsList = await runInference(onnxModelPath, preprocessedData);
        const ortOutputsList = await runInference(onnxModelBlob, preprocessedData);

        // Load postprocessor model
        const pprocModelPath = './pproc.onnx';
        const pprocSession = await ort.InferenceSession.create(pprocModelPath);

        // Convert ortOutputsList to a tensor
        const ortOutputsTensor = tf.tensor(ortOutputsList);

        console.log("ortOutputsTensor")
        console.log(ortOutputsTensor)

        // Run postprocessor model
        const pprocInputArray = Array.from(ortOutputsTensor.dataSync());
        const pprocInputName = pprocSession.inputNames[0];
        const pprocInputTensor = new ort.Tensor('float32', pprocInputArray, ortOutputsTensor.shape);
        const pprocInputs = { [pprocInputName]: pprocInputTensor };
        const pprocOutputs = await pprocSession.run(pprocInputs);

        const pprocOutput = pprocOutputs.output;
        processingFile = false;
        return pprocOutput;
    } else {
        console.log("Error computing Log Mel Spectrogram.");
    }
}

// async function runInference(onnxModelPath, inputData) {
async function runInference(onnxModelBlob, inputData) {
    try {
        const modelData = await onnxModelBlob.arrayBuffer();
        const session = await ort.InferenceSession.create(modelData);
        // const session = await ort.InferenceSession.create(onnxModelPath);

        const ortOutputsList = [];

        const [batchSize, channels, height, width] = inputData.shape;

        for (let batch = 0; batch < batchSize; batch++) {
            // Assuming input_data is a 3D tensor (similar to permute(2, 1, 0) in Python)
            const input_data_batch = inputData.slice([batch, 0, 0, 0], [1, 1, height, width]);

            const input_data_onnx = input_data_batch.transpose([0, 2, 1, 3]).reshape([1, 64, 96]);

            // Convert the input tensor to a flat array
            const inputArray = Array.from(input_data_onnx.dataSync());

            const inputDims = [1, 64, 96]
            const inputTensor = new ort.Tensor('float32', inputArray, inputDims);

            const feeds = {
                'melspectrogram': inputTensor,
            };

            // Run the inference
            const results = await session.run(feeds);

            const outputTensor = results.embeddings;

            // Convert the output tensor to a flat array
            const outputArray = Array.from(outputTensor.data);

            // Push the output to the list
            ortOutputsList.push(outputArray);
        }

        return ortOutputsList;
    } catch (error) {
        console.error('Error during inference:', error);
        return null;
    }
}

async function processAudio() {
    processingFile = true;
    const audioCtx = new (AudioContext || new webkitAudioContext())();

    initializeTensorFlow();

    const inputElement = document.getElementById('audioFileInput');
    const selectedFile = inputElement.files[0];

    const audioBuffer = await readWavFile(selectedFile, audioCtx);

    const pprocOutput = await process(audioBuffer);
    console.log(pprocOutput);

    // Load bg noise detector model
    const bgModelPath = './bg_noise_detection.onnx';
    const bgSession = await ort.InferenceSession.create(bgModelPath);

    // Run bg noise detector model
    const bgInputArray = Array.from(pprocOutput.data);
    const bgInputName = bgSession.inputNames[0];

    const bgInputTensor = new ort.Tensor('float32', bgInputArray, pprocOutput.dims);
    const bgInputs = { [bgInputName]: bgInputTensor };
    const bgOutput = await bgSession.run(bgInputs);

    console.log("bgOutput")
    // Output from the classifier
    console.log(bgOutput);
        
}

document.getElementById('processAudioButton').addEventListener('click', processAudio);

function showResults(predictions) {
    console.log(predictions)
}

function readWavFile(file, audioCtx) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            audioCtx.decodeAudioData(e.target.result, (buffer) => {
                resolve(buffer);
            });
        };
        reader.onerror = function (e) {
            reject(e);
        };
        reader.readAsArrayBuffer(file);
    });
}

async function preprocess(audioBuffer) {
    const vggishParams = {
        SAMPLE_RATE: 16000,
        STFT_WINDOW_LENGTH_SECONDS: 0.025,
        STFT_HOP_LENGTH_SECONDS: 0.010,
        NUM_MEL_BINS: 64,
        MEL_MIN_HZ: 125,
        MEL_MAX_HZ: 7500,
        LOG_OFFSET: 0.01,
        EXAMPLE_WINDOW_SECONDS: 0.96,
        EXAMPLE_HOP_SECONDS: 0.96,
    };

    async function waveformToExamples(data, sampleRate) {
        if (data && data.length) {
            data = (data.length > 1) ? mergeChannels(data) : data;

            if (sampleRate !== vggishParams.SAMPLE_RATE) {
                console.log("Resampling");
                data = await resample(data, sampleRate, vggishParams.SAMPLE_RATE);

                // wavBlob = createWavBlob(data, vggishParams.SAMPLE_RATE);

                // a = document.createElement('a');
                // a.href = URL.createObjectURL(wavBlob);
                // a.download = 'resampled-js.wav';
                // a.click();
            }
            const logMel = await computeLogMelSpectrogram(data, vggishParams.SAMPLE_RATE);
            if (logMel) {      
                const featuresSampleRate = 1.0 / vggishParams.STFT_HOP_LENGTH_SECONDS;
                const exampleWindowLength = Math.round(vggishParams.EXAMPLE_WINDOW_SECONDS * featuresSampleRate);
                const exampleHopLength = Math.round(vggishParams.EXAMPLE_HOP_SECONDS * featuresSampleRate);
                const logMelExamples = frame(logMel, exampleWindowLength, exampleHopLength);

                const logMelTensor = tf.tensor(logMelExamples, undefined, 'float32');

                const expandedTensor = logMelTensor.expandDims(1);
                return expandedTensor;
            } else {
                console.log("Error computing Log Mel Spectrogram.");
            }
        } else {
            console.log("Invalid or undefined data received.");
            return null;
        }
    }

    
    function createWavBlob(data, sampleRate) {
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = data.length * numChannels * (bitsPerSample / 8);
        const fileSize = 36 + dataSize;

        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);

        // RIFF chunk descriptor
        view.setUint32(0, 0x52494646, false); // 'RIFF'
        view.setUint32(4, fileSize - 8, true); // File size - 8

        view.setUint32(8, 0x57415645, false); // 'WAVE'

        // Format chunk
        view.setUint32(12, 0x666d7420, false); // 'fmt '
        view.setUint32(16, 16, true); // Format chunk size
        view.setUint16(20, 1, true); // Audio format (1 for PCM)
        view.setUint16(22, numChannels, true); // Number of channels
        view.setUint32(24, sampleRate, true); // Sample rate
        view.setUint32(28, byteRate, true); // Byte rate
        view.setUint16(32, blockAlign, true); // Block align
        view.setUint16(34, bitsPerSample, true); // Bits per sample

        // Data chunk
        view.setUint32(36, 0x64617461, false); // 'data'
        view.setUint32(40, dataSize, true); // Data chunk size

        // Write audio data
        for (let i = 0; i < data.length; i++) {
            // Assuming 16-bit signed PCM
            const offset = 44 + i * 2;
            if (offset + 2 <= buffer.byteLength) {
                view.setInt16(offset, data[i] * 0x7FFF, true);
            } else {
                console.error("Offset is outside the bounds of the DataView");
                break;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    function mergeChannels(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const numSamples = audioBuffer.length;
        const channels = [];

        for (let i = 0; i < numChannels; i++) {
            channels.push(audioBuffer.getChannelData(i));
        }

        const merged = new Array(numSamples).fill(0);

        for (let i = 0; i < numChannels; i++) {
            for (let j = 0; j < numSamples; j++) {
                merged[j] += channels[i][j] / numChannels;
            }
        }

        return merged;
    }

    async function resample(data, inputSampleRate, outputSampleRate) {
        try {
            const src = await LibSampleRate.create(1, inputSampleRate, outputSampleRate, {
                //converterType: LibSampleRate.ConverterType.SRC_SINC_BEST_QUALITY,
                converterType: LibSampleRate.ConverterType.SRC_LINEAR
            });

            const resampledData = await src.full(data);

            src.destroy();

            return resampledData;
        } catch (error) {
            console.error("Resample error: ", error);
            throw error;
        }
    }

    async function computeLogMelSpectrogram(data, audioSampleRate) {
        try {
            const logOffset = vggishParams.LOG_OFFSET;
            const windowLengthSecs = vggishParams.STFT_WINDOW_LENGTH_SECONDS;
            const hopLengthSecs = vggishParams.STFT_HOP_LENGTH_SECONDS;

            const windowLengthSamples = Math.round(audioSampleRate * windowLengthSecs);
            const hopLengthSamples = Math.round(audioSampleRate * hopLengthSecs);
            const fftLength = Math.pow(2, Math.ceil(Math.log2(windowLengthSamples)));

            const spectrogram = await stftMagnitude(
                data,
                fftLength,
                hopLengthSamples,
                windowLengthSamples
            );

            if (spectrogram) {
                console.log("Spectrogram calculated");
                const melSpectrogram = await computeLogMelFeatures(spectrogram, audioSampleRate);
                if (melSpectrogram) {
                    return melSpectrogram;
                } else {
                    console.log("Mel Spectrogram is undefined or null after computeLogMelFeatures.");
                    return null;
                }
            } else {
                console.log("Spectrogram is undefined or null.");
                return null;
            }
        } catch (error) {
            console.error("Error computing Log Mel Spectrogram: ", error);
            return null;
        }
    }

    async function computeLogMelFeatures(spectrogram, audioSampleRate) {
        try {
            const melSpectrogram = await melSpectrogramFromSpectrogram(
                spectrogram,
                audioSampleRate,
                vggishParams.STFT_WINDOW_LENGTH_SECONDS,
                vggishParams.STFT_HOP_LENGTH_SECONDS,
                vggishParams.NUM_MEL_BINS
            );

            if (melSpectrogram) {
                return applyLogOffset(melSpectrogram, vggishParams.LOG_OFFSET);
            } else {
                console.log("Mel Spectrogram is undefined or null after melSpectrogramFromSpectrogram.");
                return null;
            }
        } catch (error) {
            console.error("Error computing Log Mel Features: ", error);
            return null;
        }
    }

    async function melSpectrogramFromSpectrogram(spectrogram, audioSampleRate, windowLengthSecs, hopLengthSecs, numMelBins) {
        try {
            if (!spectrogram || !spectrogram.length) {
                console.log("Input spectrogram is undefined or has no length.");
                return null;
            }

            const numSpectrogramBins = spectrogram[0].length;

            const melMatrix = await spectrogramToMelMatrix(
                vggishParams.NUM_MEL_BINS,
                numSpectrogramBins,
                audioSampleRate,
                vggishParams.MEL_MIN_HZ,
                vggishParams.MEL_MAX_HZ
            );

            const melSpectrogram = [];

            for (let i = 0; i < spectrogram.length; i++) {
                try {
                    const melSpectrum = applyMelMatrix(spectrogram[i], melMatrix);
                    melSpectrogram.push(melSpectrum);
                } catch (applyMelMatrixError) {
                    console.error("Error in applyMelMatrix:", applyMelMatrixError);
                    throw applyMelMatrixError;
                }
            }
            
            return melSpectrogram;
        } catch (error) {
            console.error("Error in melSpectrogramFromSpectrogram:", error);
            throw error;
        }
    }

    function applyMelMatrix(frameData, melMatrix) {
        const melFrame = new Array(melMatrix[0].length).fill(0);

        for (let i = 0; i < melMatrix[0].length; i++) {
            for (let j = 0; j < melMatrix.length; j++) {
                melFrame[i] += frameData[j] * melMatrix[j][i];
            }
        }

        return melFrame;
    }

    function applyLogOffset(melSpectrogram, logOffset) {
        const logMelSpectrogram = melSpectrogram.map(melFrame => {
            const logFrame = melFrame.map(value => Math.log(Math.max(value, logOffset)));
            return logFrame;
        });

        return logMelSpectrogram;
    }

    function linspace(start, end, numPoints) {
        const step = (end - start) / (numPoints - 1);
        return Array.from({ length: numPoints }, (_, i) => start + step * i);
    }

    async function spectrogramToMelMatrix(numMelBins, numSpectrogramBins, audioSampleRate, lowerEdgeHertz, upperEdgeHertz) {
        try {
            const nyquistHertz = audioSampleRate / 2;
            if (lowerEdgeHertz < 0.0 || lowerEdgeHertz >= upperEdgeHertz || upperEdgeHertz > nyquistHertz) {
                throw new Error("Invalid frequency range for mel spectrogram computation");
            }

            const spectrogramBinsHertz = Array.from({ length: numSpectrogramBins }, (_, i) => (nyquistHertz * i) / (numSpectrogramBins - 1));
            const spectrogramBinsMel = hertzToMel(spectrogramBinsHertz);

            const lowerEdgeMel = hertzToMel(lowerEdgeHertz);
            const upperEdgeMel = hertzToMel(upperEdgeHertz);

            const bandEdgesMel = linspace(lowerEdgeMel, upperEdgeMel, numMelBins + 2);

            const melWeightsMatrix = Array.from({ length: numSpectrogramBins }, (_, i) => {
                return Array.from({ length: numMelBins }, (_, j) => {
                    const lowerEdgeMel = bandEdgesMel[j];
                    const centerMel = bandEdgesMel[j + 1];
                    const upperEdgeMel = bandEdgesMel[j + 2];
            
                    const lowerSlope = (spectrogramBinsMel[i] - lowerEdgeMel) / (centerMel - lowerEdgeMel);
                    const upperSlope = (upperEdgeMel - spectrogramBinsMel[i]) / (upperEdgeMel - centerMel);
            
                    return Math.max(0.0, Math.min(lowerSlope, upperSlope));
                });
            });

            melWeightsMatrix[0].fill(0);

            return melWeightsMatrix;
        } catch (error) {
            console.error("Error in spectrogramToMelMatrix: ", error);
            throw error;
        }
    }

    function hertzToMel(frequenciesHertz) {
        if (!Array.isArray(frequenciesHertz)) {
            frequenciesHertz = [frequenciesHertz];
        }
        const melBreakFrequencyHertz = 700.0;
        const melHighFrequencyQ = 1127.0;
        const result = frequenciesHertz.map(frequency => melHighFrequencyQ * Math.log(1.0 + frequency / melBreakFrequencyHertz));
        return frequenciesHertz.length === 1 ? result[0] : result;
    }

    async function stftMagnitude(signal, fftLength, hopLength, windowLength) {
        const frames = frame(signal, windowLength, hopLength);
        const window = periodicHann(windowLength);

        const windowedFrames = frames.map(frameData => 
            frameData.map((value, index) => value * window[index])
        );

        const inputTensor = tf.tensor(windowedFrames, [windowedFrames.length, windowedFrames[0].length], 'float32');

        const complexResult = tf.spectral.rfft(inputTensor, fftLength);

        const magnitudes = tf.abs(complexResult);

        const magnitudesArray = await magnitudes.array();

        return magnitudesArray;
    }

    function frame(data, windowLength, hopLength) {
        const numSamples = data.length;
        const numFrames = 1 + Math.floor((numSamples - windowLength) / hopLength);

        const frames = [];

        for (let i = 0; i < numFrames; i++) {
            const start = i * hopLength;
            const end = start + windowLength;
            const frameData = data.slice(start, end);
            frames.push(frameData);
        }
        
        return frames;
    }

    function periodicHann(windowLength) {
        const window = new Array(windowLength);
        for (let i = 0; i < windowLength; i++) {
            window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / windowLength);
        }
        return window;
    }

    try {
        const spectrogram = await waveformToExamples(audioBuffer, audioBuffer.sampleRate);

        if (spectrogram) {
            return spectrogram;
        } else {
            console.log("Error computing Log Mel Spectrogram.");
        }
    } catch (error) {
        console.error("Error in preprocess:", error);
    }
}
