import { ID } from "react-native-appwrite";
import * as FileSystem from "expo-file-system/legacy";
import { appwriteConfig, databases, storage } from "./appwrite";
import dummyData from "./data";

interface Category {
  name: string;
  description: string;
}

interface Customization {
  name: string;
  price: number;
  type: "topping" | "side" | "size" | "crust" | string; // extend as needed
}

interface MenuItem {
  name: string;
  description: string;
  image_url: string;
  price: number;
  rating: number;
  calories: number;
  protein: number;
  category_name: string;
  customizations: string[]; // list of customization names
}

interface DummyData {
  categories: Category[];
  customizations: Customization[];
  menu: MenuItem[];
}

// ensure dummyData has correct shape
const data = dummyData as DummyData;

async function clearAll(collectionId: string): Promise<void> {
  const list = await databases.listDocuments(
    appwriteConfig.databaseId,
    collectionId,
  );

  await Promise.all(
    list.documents.map((doc) =>
      databases.deleteDocument(
        appwriteConfig.databaseId,
        collectionId,
        doc.$id,
      ),
    ),
  );
}

async function clearStorage(): Promise<void> {
  const list = await storage.listFiles(appwriteConfig.bucketId);

  await Promise.all(
    list.files.map((file) =>
      storage.deleteFile(appwriteConfig.bucketId, file.$id),
    ),
  );
}

async function uploadImageToStorage(imageUrl: string): Promise<string> {
  const fileName =
    imageUrl.split("/").pop()?.split("?")[0] || `file-${Date.now()}.png`;
  const fileUri = `${FileSystem.cacheDirectory ?? ""}${fileName}`;

  try {
    const downloadResult = await FileSystem.downloadAsync(imageUrl, fileUri);
    const fileInfo = (await FileSystem.getInfoAsync(downloadResult.uri)) as {
      size?: number;
      exists: boolean;
    };

    const fileObj = {
      name: fileName,
      type: "image/png",
      size: fileInfo.size ?? 0,
      uri: downloadResult.uri,
    };

    const file = await storage.createFile(
      appwriteConfig.bucketId,
      ID.unique(),
      fileObj,
    );

    await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });

    return storage.getFileViewURL(appwriteConfig.bucketId, file.$id).toString();
  } catch (downloadErr) {
    console.warn("downloadAsync failed, attempting fallback:", downloadErr);

    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    await FileSystem.writeAsStringAsync(fileUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const fileObj = {
      name: fileName,
      type: blob.type || "image/png",
      size: blob.size,
      uri: fileUri,
    };

    const file = await storage.createFile(
      appwriteConfig.bucketId,
      ID.unique(),
      fileObj,
    );

    await FileSystem.deleteAsync(fileUri, { idempotent: true });

    return storage.getFileViewURL(appwriteConfig.bucketId, file.$id).toString();
  }
}

async function seed(): Promise<void> {
  // 1. Clear all
  await clearAll(appwriteConfig.categoriesCollectionId);
  await clearAll(appwriteConfig.customizationsCollectionId);
  await clearAll(appwriteConfig.menuCollectionId);
  await clearAll(appwriteConfig.menuCustomizationCollectionId);
  await clearStorage();

  // 2. Create Categories
  const categoryMap: Record<string, string> = {};
  for (const cat of data.categories) {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.categoriesCollectionId,
      ID.unique(),
      cat,
    );
    categoryMap[cat.name] = doc.$id;
  }

  // 3. Create Customizations
  const customizationMap: Record<string, string> = {};
  for (const cus of data.customizations) {
    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.customizationsCollectionId,
      ID.unique(),
      {
        name: cus.name,
        price: cus.price,
        type: cus.type,
      },
    );
    customizationMap[cus.name] = doc.$id;
  }

  // 4. Create Menu Items
  const menuMap: Record<string, string> = {};
  for (const item of data.menu) {
    const uploadedImage = await uploadImageToStorage(item.image_url);

    const doc = await databases.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.menuCollectionId,
      ID.unique(),
      {
        name: item.name,
        description: item.description,
        image_url: uploadedImage,
        price: item.price,
        rating: item.rating,
        calories: item.calories,
        protein: item.protein,
        categories: categoryMap[item.category_name],
      },
    );

    menuMap[item.name] = doc.$id;

    // 5. Create menu_customizations
    for (const cusName of item.customizations) {
      await databases.createDocument(
        appwriteConfig.databaseId,
        appwriteConfig.menuCustomizationCollectionId,
        ID.unique(),
        {
          menu: doc.$id,
          customizations: customizationMap[cusName],
        },
      );
    }
  }

  console.log("✅ Seeding complete.");
}

export default seed;
