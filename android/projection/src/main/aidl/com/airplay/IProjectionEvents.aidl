package com.airplay;

oneway interface IProjectionEvents {
    void changed(String state, String name, int width, int height, boolean audio, String title);
}
