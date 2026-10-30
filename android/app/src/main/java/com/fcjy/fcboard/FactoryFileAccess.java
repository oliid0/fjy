package com.fcjy.fcboard;

import android.content.Context;
import android.os.Build;
import android.os.Environment;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import java.io.*;
import java.util.*;

/** FileBrowserPopu / HDataSet: real public Whiteboard/xml and removable volumes. */
final class FactoryFileAccess {
    enum Kind {
        BOARD("xml","bzd",R.string.factory_fb_file_bzd), IMAGE("image","jpg",R.string.factory_fb_file_jpg), PDF("pdf","pdf",R.string.factory_fb_file_pdf);
        final String folder,extension;final int label;
        Kind(String folder,String extension,int label){this.folder=folder;this.extension=extension;this.label=label;}
        static Kind read(String value) throws IOException {
            if("bzd".equals(value))return BOARD;if("jpg".equals(value) || "image".equals(value))return IMAGE;if("pdf".equals(value))return PDF;
            throw new IOException("Unsupported whiteboard file type");
        }
    }
    static final long MAX_BYTES = 64L * 1024 * 1024;
    static File primary() { return Environment.getExternalStorageDirectory(); }
    static File initial() { return initial(Kind.BOARD); }
    static File initial(Kind kind) { return new File(primary(), "Whiteboard/"+kind.folder); }
    static List<File> removable(Context context) {
        List<File> roots = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 30) {
            StorageManager manager = (StorageManager) context.getSystemService(Context.STORAGE_SERVICE);
            if (manager != null) for (StorageVolume volume : manager.getStorageVolumes()) {
                File directory = volume.getDirectory();
                if (volume.isRemovable() && !volume.isPrimary() && !volume.isEmulated() && (Environment.MEDIA_MOUNTED.equals(volume.getState()) || Environment.MEDIA_MOUNTED_READ_ONLY.equals(volume.getState())) && directory != null && directory.isDirectory()) roots.add(directory);
            }
        } else {
            for (File directory : context.getExternalFilesDirs(null)) {
                if (directory == null || !Environment.isExternalStorageRemovable(directory)) continue;
                String path = directory.getAbsolutePath();
                int android = path.indexOf("/Android/");
                if (android > 0) {
                    File root = new File(path.substring(0, android));
                    if (root.isDirectory() && !roots.contains(root)) roots.add(root);
                }
            }
        }
        return roots;
    }
    static String volumeLabel(Context context, File root) {
        StorageManager manager=(StorageManager)context.getSystemService(Context.STORAGE_SERVICE);
        StorageVolume volume=manager==null?null:manager.getStorageVolume(root);
        if(volume!=null)try{
            Object label=volume.getClass().getMethod("getUserLabel").invoke(volume);
            if(label instanceof String && !((String)label).isEmpty())return (String)label;
        }catch(ReflectiveOperationException|RuntimeException ignored){}
        return root.getName();
    }
    static boolean contains(File root, File file) throws IOException {
        String base = root.getCanonicalPath(), path = file.getCanonicalPath();
        return path.equals(base) || path.startsWith(base + File.separator);
    }
    static boolean boardFile(File file) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        return name.endsWith(".bzd") || name.endsWith(".bz") || name.endsWith(".bnf");
    }
    static boolean accepts(File file,Kind kind){
        if(kind==Kind.BOARD)return boardFile(file);
        String name=file.getName().toLowerCase(Locale.ROOT);
        return kind==Kind.PDF?name.endsWith(".pdf"):name.matches(".*\\.(jpg|jpeg|bmp|png|webp|gif)$");
    }
    static List<File> list(File root, File directory) throws IOException {
        return list(root,directory,Kind.BOARD);
    }
    static List<File> list(File root, File directory,Kind kind) throws IOException {
        if (!contains(root, directory)) throw new IOException("Folder is outside the selected storage");
        File[] found = directory.listFiles();
        if (found == null) throw new IOException("Cannot read folder");
        List<File> files = new ArrayList<>();
        for (File file : found) if (contains(root, file) && (file.isDirectory() || accepts(file,kind))) files.add(file);
        return files;
    }
    static File destination(File root, File folder, String name) throws IOException {
        return destination(root,folder,name,Kind.BOARD);
    }
    static File destination(File root, File folder, String name,Kind kind) throws IOException {
        String trimmed = name.trim();
        if (trimmed.isEmpty() || trimmed.equals(".") || trimmed.equals("..") || trimmed.indexOf('/') >= 0 || trimmed.indexOf('\\') >= 0 || trimmed.indexOf('\0') >= 0) throw new IOException("Invalid board file name");
        String suffix="."+kind.extension;
        File target = new File(folder, trimmed.toLowerCase(Locale.ROOT).endsWith(suffix) ? trimmed : trimmed + suffix);
        if (!contains(root, target) || !folder.isDirectory()) throw new IOException("Cannot save outside the selected storage");
        return target;
    }
    static void copyAtomic(File source, File target) throws IOException {
        if (!source.isFile() || source.length() > MAX_BYTES) throw new IOException("BZD file is too large or unavailable");
        File folder=target.getParentFile();
        if(folder==null || !folder.isDirectory())throw new IOException("Save folder is unavailable");
        File pending=File.createTempFile(".bzd-save-",".tmp",folder);
        try {
            try(InputStream input=new FileInputStream(source);FileOutputStream output=new FileOutputStream(pending)){
                byte[] buffer = new byte[65536]; int count; long total = 0;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_BYTES) throw new IOException("BZD file is too large");
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if(!pending.renameTo(target))throw new IOException("Cannot replace the selected BZD file");
        }finally{if(pending.exists())pending.delete();}
    }
    /** Stage the whole selected JPG batch before replacing any existing page. */
    static void copyBatchAtomic(List<File> sources,List<File> targets) throws IOException {
        if(sources.size()!=targets.size() || sources.isEmpty())throw new IOException("Invalid export batch");
        List<File> staged=new ArrayList<>(),backups=new ArrayList<>();int replaced=0;
        try{
            long total=0;
            for(int i=0;i<sources.size();i++){
                File source=sources.get(i),target=targets.get(i);total+=source.length();
                if(!source.isFile() || total>MAX_BYTES || target.isDirectory())throw new IOException("Export is too large or a target is a folder");
                File temp=File.createTempFile(".board-export-",".tmp",target.getParentFile());staged.add(temp);copyAtomic(source,temp);
            }
            for(File target:targets){
                File backup=null;
                if(target.exists()){
                    backup=File.createTempFile(".board-previous-",".tmp",target.getParentFile());
                    if(!backup.delete() || !target.renameTo(backup))throw new IOException("Cannot preserve previous page file");
                }
                backups.add(backup);
            }
            for(int i=0;i<targets.size();i++){
                if(!staged.get(i).renameTo(targets.get(i)))throw new IOException("Cannot save selected page file");replaced++;
            }
        }catch(IOException error){
            for(int i=0;i<replaced;i++)if(!targets.get(i).delete())error.addSuppressed(new IOException("Could not remove partial page export"));
            for(int i=0;i<backups.size();i++)if(backups.get(i)!=null && !backups.get(i).renameTo(targets.get(i)))error.addSuppressed(new IOException("Could not restore previous page file: "+backups.get(i)));
            throw error;
        }finally{
            for(File file:staged)if(file.exists())file.delete();
        }
        for(File backup:backups)if(backup!=null)backup.delete();
    }
}
