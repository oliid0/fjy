package com.fcjy.fcboard;

import static org.junit.Assert.*;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;

public class FactoryFileOperationsTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    @Test public void copiesAndCutsRealDirectoriesThenRenamesAndDeletesWithoutOverwriting() throws Exception {
        File root=temporary.newFolder("disk"), source=FactoryFileOperations.createFolder(root,root,"课件");
        Files.write(new File(source,"lesson.txt").toPath(),"lesson".getBytes(StandardCharsets.UTF_8));
        File usb=temporary.newFolder("usb");
        File copied=FactoryFileOperations.paste(root,source,usb,usb,false);
        assertTrue(new File(copied,"lesson.txt").isFile()); assertTrue(source.isDirectory());
        assertThrows(Exception.class,()->FactoryFileOperations.paste(root,source,usb,usb,false));
        File renamed=FactoryFileOperations.rename(usb,copied,"课堂");
        File moved=FactoryFileOperations.paste(usb,renamed,root,root,true);
        assertFalse(renamed.exists()); assertTrue(new File(moved,"lesson.txt").isFile());
        FactoryFileOperations.delete(root,moved); assertFalse(moved.exists()); assertTrue(source.exists());
    }
    @Test public void rejectsEscapesRootDeletionAndCopyingIntoItself() throws Exception {
        File root=temporary.newFolder("disk"), folder=FactoryFileOperations.createFolder(root,root,"folder");
        assertThrows(Exception.class,()->FactoryFileOperations.createFolder(root,root,"../escape"));
        assertThrows(Exception.class,()->FactoryFileOperations.delete(root,root));
        assertThrows(Exception.class,()->FactoryFileOperations.paste(root,folder,root,folder,false));
    }
}
