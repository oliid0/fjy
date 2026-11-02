package com.fcjy.fcboard;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.UUID;

/** FileBrowser's rename/copy/cut/delete/new-folder operations, without its APK. */
final class FactoryFileOperations {
    private static File inside(File root, File file) throws IOException {
        String base = root.getCanonicalPath(), path = file.getCanonicalPath();
        if ((!path.equals(base) && !path.startsWith(base + File.separator)) || Files.isSymbolicLink(file.toPath())) throw new IOException("文件不在所选存储目录内");
        return file;
    }
    private static File child(File root, File folder, String name) throws IOException {
        if (name == null || name.trim().isEmpty() || name.equals(".") || name.equals("..") || name.length() > 160 || name.contains("/") || name.contains("\\") || name.chars().anyMatch(c -> c < 32)) throw new IOException("文件名无效");
        inside(root, folder);
        if (!folder.isDirectory()) throw new IOException("目标文件夹不可用");
        return inside(root, new File(folder, name.trim()));
    }
    static File createFolder(File root, File folder, String name) throws IOException {
        File target = child(root, folder, name);
        if (!target.mkdir()) throw new IOException("无法新建文件夹，名称可能已存在");
        return target;
    }
    static File rename(File root, File source, String name) throws IOException {
        inside(root, source);
        if (source.getCanonicalFile().equals(root.getCanonicalFile())) throw new IOException("不能修改存储根目录");
        File target = child(root, source.getParentFile(), name);
        if (target.exists()) throw new IOException("同名文件已存在");
        Files.move(source.toPath(), target.toPath());
        return target;
    }
    static void delete(File root, File source) throws IOException {
        inside(root, source);
        if (source.getCanonicalFile().equals(root.getCanonicalFile())) throw new IOException("不能删除存储根目录");
        remove(root, source, new int[]{0});
    }
    private static void remove(File root, File source, int[] count) throws IOException {
        inside(root, source);
        if (++count[0] > 10000) throw new IOException("单次操作文件数量超过10000");
        if (source.isDirectory()) {
            File[] children = source.listFiles();
            if (children == null) throw new IOException("无法读取文件夹");
            for (File child : children) remove(root, child, count);
        }
        Files.delete(source.toPath());
    }
    static File paste(File sourceRoot, File source, File targetRoot, File folder, boolean cut) throws IOException {
        inside(sourceRoot, source);
        if (!source.exists() || source.getCanonicalFile().equals(sourceRoot.getCanonicalFile())) throw new IOException("源文件不可用");
        File target = child(targetRoot, folder, source.getName());
        if (target.exists()) throw new IOException("同名文件已存在，请先重命名");
        if (target.getCanonicalPath().startsWith(source.getCanonicalPath() + File.separator)) throw new IOException("不能复制到自身文件夹内");
        if (cut) try { Files.move(source.toPath(), target.toPath()); return target; } catch (IOException crossVolume) { /* Copy completely before deleting the source on another volume. */ }
        File staging = child(targetRoot, folder, ".fc-copy-" + UUID.randomUUID());
        if (!staging.mkdir()) throw new IOException("无法准备复制目录");
        try {
            File staged = new File(staging, source.getName());
            copy(sourceRoot, source, staged, new long[]{0, 0});
            Files.move(staged.toPath(), target.toPath());
        } finally {
            if (staging.exists()) remove(targetRoot, staging, new int[]{0});
        }
        if (cut) delete(sourceRoot, source);
        return target;
    }
    private static void copy(File sourceRoot, File source, File target, long[] budget) throws IOException {
        inside(sourceRoot, source);
        if (Thread.currentThread().isInterrupted()) throw new IOException("文件操作已取消");
        if (++budget[0] > 10000 || (budget[1] += source.isFile() ? source.length() : 0) > 1024L * 1024 * 1024) throw new IOException("单次复制最多10000个文件、1GB");
        if (source.isDirectory()) {
            Files.createDirectory(target.toPath());
            File[] children = source.listFiles();
            if (children == null) throw new IOException("无法读取源文件夹");
            for (File child : children) copy(sourceRoot, child, new File(target, child.getName()), budget);
        } else Files.copy(source.toPath(), target.toPath());
    }
}
