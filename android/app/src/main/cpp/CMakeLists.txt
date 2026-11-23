cmake_minimum_required(VERSION 3.22.1)
project(fcboard_media LANGUAGES CXX)

set(ORT_AAR "${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/onnxruntime-android-1.23.2.aar")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${ORT_AAR}")
file(ARCHIVE_EXTRACT INPUT "${ORT_AAR}" DESTINATION "${CMAKE_CURRENT_BINARY_DIR}"
    PATTERNS "headers/*")

add_library(voice_enhancement SHARED voice_enhancement.cpp)
target_compile_features(voice_enhancement PRIVATE cxx_std_17)
target_include_directories(voice_enhancement SYSTEM PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/headers")
# Resolve the API from the runtime already packaged by the app for this ABI.
target_link_libraries(voice_enhancement PRIVATE android dl log)
