package com.fcjy.fcboard;

import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONObject;

final class TestPageLocalization {
    static String repositoryText(String relative) throws Exception {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null) {
            Path file = directory.resolve(relative);
            if (Files.isRegularFile(file)) return Files.readString(file);
            directory = directory.getParent();
        }
        throw new IllegalStateException("Missing repository fixture: " + relative);
    }
    static void configure(String language) throws Exception {
        JSONObject catalog = new JSONObject(repositoryText("packages/fcboard/locales/" + language + ".json"));
        PageLocalization.configure(new JSONObject().put("language", language).put("strings", catalog.getJSONObject("fcboard").getJSONObject("remotePages")));
    }
    static String transferPage() throws Exception { return repositoryText("android/app/src/main/assets/transfer.html"); }
}
