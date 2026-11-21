#include <android/log.h>

__attribute__((visibility("default")))
int SmartGeniusInit(int epollFd) {
    (void) epollFd;
    __android_log_print(ANDROID_LOG_INFO, "FcboardCastPlus", "Using SDK Java network-change callbacks");
    return 0;
}

__attribute__((visibility("default")))
void SmartGeniusClean(void) {}
