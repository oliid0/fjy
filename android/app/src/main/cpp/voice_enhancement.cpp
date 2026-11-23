#define ORT_API_MANUAL_INIT
#include <onnxruntime_cxx_api.h>
#include <onnxruntime_session_options_config_keys.h>

#include <android/asset_manager_jni.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>

namespace {
constexpr int kModelRate = 48000;
constexpr int kHop = 512;
constexpr int kRecurrentSize = 48 * 48;
constexpr int kTensorCount = 6;
constexpr float kPcmScale = 32768.0f;
constexpr float kWetMix[] = {0.f, 0.30f, 0.60f, 0.90f};
constexpr const char* kInputs[] = {
    "wav_in", "cache_in_0", "cache_in_1", "cache_in_2", "cache_in_3", "cache_in_4"
};
constexpr const char* kOutputs[] = {
    "wav_out", "cache_out_0", "cache_out_1", "cache_out_2", "cache_out_3", "cache_out_4"
};

void initializeRuntime() {
    static std::once_flag initialized;
    std::call_once(initialized, [] {
        void* runtime = dlopen("libonnxruntime.so", RTLD_NOW | RTLD_LOCAL);
        if (!runtime) {
            throw std::runtime_error("Packaged ONNX Runtime could not be loaded");
        }
        using GetApiBase = const OrtApiBase* (ORT_API_CALL*)();
        auto getApiBase = reinterpret_cast<GetApiBase>(dlsym(runtime, "OrtGetApiBase"));
        const auto* api = getApiBase ? getApiBase()->GetApi(ORT_API_VERSION) : nullptr;
        if (!api) {
            dlclose(runtime);
            throw std::runtime_error("Packaged ONNX Runtime does not provide the required API");
        }
        Ort::InitApi(api);
        // The C++ API table must remain valid for the process lifetime.
    });
}

Ort::SessionOptions sessionOptions() {
    Ort::SessionOptions options;
    options.SetExecutionMode(ORT_SEQUENTIAL);
    options.SetIntraOpNumThreads(1);
    options.SetInterOpNumThreads(1);
    options.SetGraphOptimizationLevel(ORT_ENABLE_ALL);
    options.AddConfigEntry(kOrtSessionOptionsConfigAllowIntraOpSpinning, "0");
    options.AddConfigEntry(kOrtSessionOptionsConfigAllowInterOpSpinning, "0");
    return options;
}

int voiceChannel(int channels) {
    // Android's standard surround layout places front center after front left/right.
    return channels == 3 || channels >= 5 ? 2 : 0;
}

float center(const int16_t* frame, int channels) {
    if (channels == 2 || channels == 4) {
        return (frame[0] + frame[1]) / (2 * kPcmScale);
    }
    return frame[voiceChannel(channels)] / kPcmScale;
}

float sampleCenter(const int16_t* pcm, int frames, int capacity, int channels,
                   double position, float previous) {
    if (frames == 0) {
        return 0;
    }
    if (position < 0) {
        return previous + static_cast<float>(std::max(0.0, position + 1)) * (center(pcm, channels) - previous);
    }
    position = std::min(position, double(capacity - 1));
    int left = static_cast<int>(position);
    int right = std::min(left + 1, capacity - 1);
    float a = left < frames ? center(pcm + left * channels, channels) : 0;
    float b = right < frames ? center(pcm + right * channels, channels) : 0;
    return a + static_cast<float>(position - left) * (b - a);
}

// ITU-R BS.1770 K-weighting at the model's fixed 48 kHz. Each path
// maintains its own filter history so the energy comparison spans hop boundaries.
struct KWeighting {
    double shelf1 = 0, shelf2 = 0, high1 = 0, high2 = 0;

    double sample(double x) {
        const double shelf = 1.53512485958697 * x + shelf1;
        shelf1 = -2.69169618940638 * x + 1.69065929318241 * shelf + shelf2;
        shelf2 = 1.19839281085285 * x - 0.73248077421585 * shelf;
        const double high = shelf + high1;
        high1 = -2 * shelf + 1.99004745483398 * high + high2;
        high2 = shelf - 0.99007225036621 * high;
        return high;
    }
};

class Enhancer {
public:
    Enhancer(const void* model, size_t length)
        : session(environment, model, length, sessionOptions()) {
        constexpr int64_t waveShape[] = {1, kHop};
        constexpr int64_t recurrentShape[] = {1, 48, 48};
        bind(0, waveform.data(), enhanced.data(), kHop, waveShape);
        bind(1, overlapIn.data(), overlapOut.data(), kHop, waveShape);
        bind(2, synthesisIn.data(), synthesisOut.data(), kHop, waveShape);
        for (int i = 0; i < 3; ++i) {
            bind(i + 3, recurrentIn[i].data(), recurrentOut[i].data(), kRecurrentSize, recurrentShape);
        }
        runHop();
        reset();
    }

    void reset() {
        for (int i = 1; i < kTensorCount; ++i) {
            const int size = i < 3 ? kHop : kRecurrentSize;
            std::fill_n(inputs[i].GetTensorMutableData<float>(), size, 0.f);
        }
        dryFilter = {};
        wetFilter = {};
        primed = false;
        mix = 0;
        gain = 1;
        dryPower = 0;
        wetPower = 0;
        previousInput = 0;
    }

    bool process(int16_t* pcm, int dryFrames, int dryPhase, const int16_t* next,
                 int nextFrames, int nextPhase, int nextCapacity, int channels, int rate, int level) {
        const float target = kWetMix[level];
        if (target == 0 && mix == 0) {
            return false;
        }

        const double step = double(rate) / kModelRate;
        const double offset = -double(nextPhase) / kModelRate;
        // Average a short window when decimating high-rate PCM. Common 44.1/48 kHz
        // tracks use linear interpolation or an exact 1:1 mapping.
        const int taps = (rate + kModelRate - 1) / kModelRate;
        for (int i = 0; i < kHop; ++i) {
            float sum = 0;
            for (int tap = 0; tap < taps; ++tap) {
                const double position = offset + i * step + (tap + 0.5) * step / taps - step / 2;
                sum += sampleCenter(next, nextFrames, nextCapacity, channels, position, previousInput);
            }
            waveform[i] = sum / taps;
        }
        runHop();

        // The export adds 512 samples of overlap. The first run primes the cache;
        // subsequent runs produce the enhancement for the held dry hop.
        if (primed && dryFrames > 0) {
            mixHop(pcm, dryFrames, dryPhase, channels, rate, target);
        }
        reference = waveform;
        primed = true;
        previousInput = nextFrames == nextCapacity ? center(next + (nextFrames - 1) * channels, channels) : 0;
        return target > 0 || mix > 0;
    }

private:
    void runHop() {
        session.Run(runOptions, kInputs, inputs.data(), inputs.size(),
                    kOutputs, outputs.data(), outputs.size());
        // Rebind by swapping the tensor handles, keeping all cache storage preallocated.
        for (int i = 1; i < kTensorCount; ++i) {
            std::swap(inputs[i], outputs[i]);
        }
    }

    template <size_t Dimensions>
    void bind(int index, float* input, float* output, size_t count,
              const int64_t (&shape)[Dimensions]) {
        inputs[index] = Ort::Value::CreateTensor<float>(memory, input, count, shape, Dimensions);
        outputs[index] = Ort::Value::CreateTensor<float>(memory, output, count, shape, Dimensions);
    }

    static float finite(float value) {
        return std::isfinite(value) ? value : 0;
    }

    float wetAt(int frame, int phase, int rate) const {
        const double position = (double(frame) * kModelRate + phase) / rate;
        int left = std::min(static_cast<int>(position), kHop - 1);
        int right = std::min(left + 1, kHop - 1);
        float a = finite(enhanced[left]);
        float b = finite(enhanced[right]);
        return a + static_cast<float>(position - left) * (b - a);
    }

    void mixHop(int16_t* pcm, int frames, int phase, int channels, int rate, float target) {
        double dryEnergy = 0, wetEnergy = 0;
        for (int i = 0; i < kHop; ++i) {
            const double dry = dryFilter.sample(reference[i]);
            const double wet = wetFilter.sample(finite(enhanced[i]));
            dryEnergy += dry * dry;
            wetEnergy += wet * wet;
        }
        // Match weighted energy over roughly 400 ms. A second, current-hop
        // ceiling prevents a quiet passage from inheriting a loud passage's gain.
        constexpr double smoothing = 0.0263143; // 1 - exp(-512 / (48000 * .4))
        dryPower += smoothing * (dryEnergy - dryPower);
        wetPower += smoothing * (wetEnergy - wetPower);
        const double ratio = std::min(dryPower / (wetPower + 1e-12), dryEnergy / (wetEnergy + 1e-12));
        const float goal = std::min(1.0, .98 * std::sqrt(ratio));
        const float gainStep = (goal - gain) / frames * (goal < gain ? .8f : .16f);
        const float fadeStep = 1.f / (0.025f * rate);
        const int first = voiceChannel(channels);
        const int last = channels == 2 || channels == 4 ? 1 : first;
        for (int i = 0; i < frames; ++i) {
            mix += std::clamp(target - mix, -fadeStep, fadeStep);
            gain += gainStep;
            const float voice = gain * wetAt(i, phase, rate);
            for (int ch = 0; ch < channels; ++ch) {
                int16_t& sample = pcm[i * channels + ch];
                const float dry = sample / kPcmScale;
                const float wet = ch >= first && ch <= last ? voice : 0;
                float mixed = dry + mix * (wet - dry);
                // Apply the soft knee only to peaks introduced by the mix.
                constexpr float knee = .96f;
                if (std::abs(mixed) > std::max(knee, std::abs(dry))) {
                    const float excess = (std::abs(mixed) - knee) / (1 - knee);
                    const float limited = knee + (1 - knee) * excess / (1 + excess);
                    mixed = std::copysign(std::max(std::abs(dry), limited), mixed);
                }
                sample = static_cast<int16_t>(std::lrint(std::clamp(mixed, -1.f, 32767 / kPcmScale) * kPcmScale));
            }
        }
    }

    Ort::Env environment{ORT_LOGGING_LEVEL_WARNING, "FcboardVoiceEnhancement"};
    Ort::Session session;
    Ort::MemoryInfo memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    Ort::RunOptions runOptions;
    std::array<float, kHop> waveform{}, enhanced{}, reference{};
    std::array<float, kHop> overlapIn{}, overlapOut{}, synthesisIn{}, synthesisOut{};
    std::array<std::array<float, kRecurrentSize>, 3> recurrentIn{}, recurrentOut{};
    std::array<Ort::Value, kTensorCount> inputs{nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};
    std::array<Ort::Value, kTensorCount> outputs{nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};
    bool primed = false;
    float mix = 0;
    float gain = 1;
    KWeighting dryFilter, wetFilter;
    double dryPower = 0, wetPower = 0;
    float previousInput = 0;
};
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_fcjy_fcboard_VoiceEnhancementProcessor_00024Native_load(JNIEnv* env, jclass, jobject manager) {
    try {
        initializeRuntime();
        std::unique_ptr<AAsset, decltype(&AAsset_close)> asset(
            AAssetManager_open(AAssetManager_fromJava(env, manager),
                               "media/fastenhancer-s-48khz.onnx", AASSET_MODE_BUFFER),
            AAsset_close);
        if (!asset || !AAsset_getBuffer(asset.get())) {
            throw std::runtime_error("FastEnhancer-S asset is missing or unreadable");
        }
        auto model = std::make_unique<Enhancer>(AAsset_getBuffer(asset.get()), AAsset_getLength(asset.get()));
        return reinterpret_cast<jlong>(model.release());
    } catch (const std::exception& error) {
        __android_log_print(ANDROID_LOG_ERROR, "VoiceEnhancement", "%s", error.what());
        return 0;
    }
}

extern "C" JNIEXPORT jint JNICALL
Java_com_fcjy_fcboard_VoiceEnhancementProcessor_00024Native_process(
        JNIEnv* env, jclass, jlong handle, jobject dry, jint dryOffset, jint dryFrames,
        jint dryPhase, jobject next, jint nextFrames, jint nextPhase, jint nextCapacity, jint channels,
        jint rate, jint level, jboolean reset) {
    auto& model = *reinterpret_cast<Enhancer*>(handle);
    auto* pcm = static_cast<int16_t*>(env->GetDirectBufferAddress(dry)) + dryOffset / sizeof(int16_t);
    auto* ahead = static_cast<const int16_t*>(env->GetDirectBufferAddress(next));
    try {
        if (reset) {
            model.reset();
        }
        return model.process(pcm, dryFrames, dryPhase, ahead, nextFrames, nextPhase, nextCapacity, channels, rate, level);
    } catch (const std::exception& error) {
        __android_log_print(ANDROID_LOG_ERROR, "VoiceEnhancement", "%s", error.what());
        return -1;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_fcjy_fcboard_VoiceEnhancementProcessor_00024Native_release(JNIEnv*, jclass, jlong handle) {
    delete reinterpret_cast<Enhancer*>(handle);
}
