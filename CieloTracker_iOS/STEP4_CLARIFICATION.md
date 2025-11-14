# Step 4 Clarification: Creating Folder Structure

## What You Need to Do

Create **4 separate groups** (folders) in your Xcode project.

---

## Detailed Steps

### 1. Right-Click on Project
- In the **Project Navigator** (left sidebar)
- Find the **blue folder icon** named `CieloTrackerPro` (this is your project)
- **Right-click** on it

### 2. Create First Group: Models
- From the menu, select **"New Group"**
- A new group will appear (it might say "New Group" or be highlighted)
- **Type:** `Models`
- Press **Enter** to confirm

### 3. Create Second Group: Services
- **Right-click** on `CieloTrackerPro` again
- Select **"New Group"**
- **Type:** `Services`
- Press **Enter**

### 4. Create Third Group: Views
- **Right-click** on `CieloTrackerPro` again
- Select **"New Group"**
- **Type:** `Views`
- Press **Enter**

### 5. Create Fourth Group: ViewModels
- **Right-click** on `CieloTrackerPro` again
- Select **"New Group"**
- **Type:** `ViewModels`
- Press **Enter**

---

## Final Structure Should Look Like:

```
CieloTrackerPro (blue folder)
├── Models (yellow folder)
├── Services (yellow folder)
├── Views (yellow folder)
├── ViewModels (yellow folder)
└── (other default files like Assets.xcassets, etc.)
```

**Note:** Groups appear as **yellow folders** in Xcode (not blue).

---

## Why Create Groups?

Groups help organize your code:
- **Models/** - Data models (Flight, WeatherData)
- **Services/** - API and sync services
- **Views/** - UI screens
- **ViewModels/** - Business logic

This keeps your code organized and easy to navigate!

---

## Quick Checklist

- [ ] Created "Models" group
- [ ] Created "Services" group
- [ ] Created "Views" group
- [ ] Created "ViewModels" group
- [ ] All 4 groups appear under CieloTrackerPro

---

## Next Step

After creating all 4 groups, proceed to **Step 5: Add Project Files** where you'll drag files into these groups.

