// State variables
let usersData = [];
let currentFolderId = null;
let currentUserId = null;
let isSettingPassword = false;
let filesData = [];

// DOM Elements
const loader = document.getElementById('loader');
const toast = document.getElementById('toast');
const foldersView = document.getElementById('folders-view');
const filesView = document.getElementById('files-view');
const foldersList = document.getElementById('folders-list');
const filesList = document.getElementById('files-list');
const btnBack = document.getElementById('btn-back');
const currentFolderName = document.getElementById('current-folder-name');
const emptyState = document.getElementById('empty-state');
const fileUpload = document.getElementById('file-upload');
const btnDeleteSelected = document.getElementById('btn-delete-selected');

// Modal Elements
const passwordModal = document.getElementById('password-modal');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const passwordForm = document.getElementById('password-form');
const passwordInput = document.getElementById('password-input');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnSubmitPassword = document.getElementById('btn-submit-password');

// Format bytes
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Show Toast
function showToast(message, isError = true) {
  toast.textContent = message;
  toast.className = `fixed top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg transition-transform duration-300 z-50 toast-show ${isError ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`;

  setTimeout(() => {
    toast.classList.remove('toast-show');
    // Hide totally after transition
    setTimeout(() => {
      toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded shadow-lg transition-transform duration-300 translate-y-[-150%] z-50';
    }, 300);
  }, 3000);
}

// Show/Hide Loader
function setLoader(show) {
  if (show) {
    loader.classList.remove('hidden');
  } else {
    loader.classList.add('hidden');
  }
}

// Disable/Enable submit button
function setSubmitLoading(loading) {
  const btnText = btnSubmitPassword.querySelector('span');
  if (loading) {
    btnSubmitPassword.disabled = true;
    btnSubmitPassword.classList.add('opacity-50', 'cursor-not-allowed');
    btnText.textContent = 'Tekshirilmoqda...';
  } else {
    btnSubmitPassword.disabled = false;
    btnSubmitPassword.classList.remove('opacity-50', 'cursor-not-allowed');
    btnText.textContent = 'Tasdiqlash';
  }
}

// Init App
async function init() {
  try {
    setLoader(true);
    const data = await fetchUsers();
    usersData = data.users;

    // Update Drive Storage Widget
    const driveText = document.getElementById('drive-text');
    const driveProgress = document.getElementById('drive-progress');

    if (data.driveStorage) {
      const usage = parseInt(data.driveStorage.usage || 0);
      const limit = parseInt(data.driveStorage.limit || (15 * 1024 * 1024 * 1024));
      const percentage = Math.min((usage / limit) * 100, 100);

      driveText.textContent = `${formatBytes(usage)} / ${formatBytes(limit)}`;
      driveProgress.style.width = `${percentage}%`;

      if (percentage > 90) driveProgress.classList.replace('bg-blue-500', 'bg-red-500');
      else if (percentage > 70) driveProgress.classList.replace('bg-blue-500', 'bg-yellow-500');
    }

    renderFolders();
    foldersView.classList.remove('hidden');
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoader(false);
  }
}

// Render Folders
function renderFolders() {
  foldersList.innerHTML = '';
  usersData.forEach(user => {
    const li = document.createElement('li');
    li.className = 'p-4 hover:bg-gray-50 flex items-center justify-between cursor-pointer transition-colors';
    li.onclick = () => openFolderModal(user);

    // Parol qo'yilganmi yoki yo'qmi ko'rsatamiz
    const lockIcon = user.hasPassword 
      ? '<i class="fa-solid fa-lock text-green-500 text-sm"></i>' 
      : '<i class="fa-solid fa-lock-open text-gray-400 text-sm"></i>';

    li.innerHTML = `
      <div class="flex items-center gap-3">
        <i class="fa-solid fa-folder text-yellow-400 text-2xl"></i>
        <span class="font-medium text-gray-700">${user.name}</span>
        ${lockIcon}
      </div>
      <div class="flex items-center gap-3">
        <i class="fa-solid fa-chevron-right text-gray-400 text-sm"></i>
      </div>
    `;
    foldersList.appendChild(li);
  });
}

// Open Password Modal
function openFolderModal(user) {
  currentUserId = user.id;
  passwordInput.value = '';

  if (!user.hasPassword) {
    isSettingPassword = true;
    modalTitle.textContent = "Yangi parol o'rnatish";
    modalDesc.textContent = `${user.name}, papkangiz uchun xavfsiz parol o'ylab toping. Bu parol orqali keyinchalik kirasiz.`;
  } else {
    isSettingPassword = false;
    modalTitle.textContent = "Parolni kiriting";
    modalDesc.textContent = `${user.name}, papkaga kirish uchun parolni kiriting.`;
  }

  // Reset submit button state
  setSubmitLoading(false);
  
  passwordModal.classList.remove('hidden');
  setTimeout(() => passwordInput.focus(), 100);
}

// Close Modal
function closeModal(clearUser = false) {
  passwordModal.classList.add('hidden');
  passwordInput.value = '';
  setSubmitLoading(false);
  if (clearUser) {
    currentUserId = null;
  }
}

btnCloseModal.onclick = () => closeModal(true);

// Modal tashqarisiga bosilganda yopish
passwordModal.addEventListener('click', (e) => {
  if (e.target === passwordModal) {
    closeModal(true);
  }
});

// Password Submit
passwordForm.onsubmit = async (e) => {
  e.preventDefault();
  const pwd = passwordInput.value;
  if (!pwd) return;

  try {
    setSubmitLoading(true);

    if (isSettingPassword) {
      // Parol o'rnatish
      await setPassword(currentUserId, pwd);
      // Update local state
      const user = usersData.find(u => u.id === currentUserId);
      if (user) user.hasPassword = true;
      showToast("Parol muvaffaqiyatli o'rnatildi!", false);
      // Now authenticate to get folder ID
      const authData = await authenticate(currentUserId, pwd);
      openFolder(authData.folderId);
    } else {
      // Parol tekshirish
      const authData = await authenticate(currentUserId, pwd);
      openFolder(authData.folderId);
    }
  } catch (error) {
    // MUHIM: Modal yopilmasin, xatolik ko'rsatilsin va qayta kiritish imkoni bo'lsin
    showToast(error.message);
    passwordInput.value = '';
    passwordInput.focus();
    setSubmitLoading(false);
  }
};

// Open Folder View
async function openFolder(folderId) {
  currentFolderId = folderId;
  closeModal();

  const user = usersData.find(u => u.id === currentUserId);
  currentFolderName.textContent = user ? user.name : 'Papka';

  foldersView.classList.add('hidden');
  filesView.classList.remove('hidden');

  await loadFiles();
}

// Load Files
async function loadFiles() {
  try {
    setLoader(true);
    const data = await fetchFiles(currentFolderId);
    filesData = data.files || [];
    renderFiles();
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoader(false);
  }
}

// Render Files
function renderFiles() {
  filesList.innerHTML = '';
  btnDeleteSelected.classList.add('hidden');

  if (filesData.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  filesData.forEach(file => {
    const li = document.createElement('li');
    li.className = 'p-3 sm:p-4 hover:bg-gray-50 flex items-center justify-between transition-colors gap-2 sm:gap-4';

    // File Icon based on type
    let iconClass = 'fa-file text-gray-400';
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) iconClass = 'fa-file-pdf text-red-500';
    else if (name.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) iconClass = 'fa-file-image text-blue-500';
    else if (name.match(/\.(mp4|avi|mov|mkv|webm)$/)) iconClass = 'fa-file-video text-purple-500';
    else if (name.match(/\.(mp3|wav|ogg|flac)$/)) iconClass = 'fa-file-audio text-pink-500';
    else if (name.match(/\.(zip|rar|7z|tar|gz)$/)) iconClass = 'fa-file-zipper text-yellow-600';
    else if (name.match(/\.(doc|docx)$/)) iconClass = 'fa-file-word text-blue-700';
    else if (name.match(/\.(xls|xlsx)$/)) iconClass = 'fa-file-excel text-green-600';
    else if (name.match(/\.(ppt|pptx)$/)) iconClass = 'fa-file-powerpoint text-orange-500';
    else if (name.match(/\.(txt|md)$/)) iconClass = 'fa-file-lines text-gray-500';
    else if (name.match(/\.(py|js|html|css|java|c|cpp)$/)) iconClass = 'fa-file-code text-emerald-500';

    const downloadLink = file.webContentLink || `https://drive.google.com/uc?export=download&id=${file.id}`;
    const viewLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

    li.innerHTML = `
      <div class="flex items-center gap-3 flex-1 min-w-0">
        <input type="checkbox" class="file-checkbox" data-id="${file.id}">
        <i class="fa-solid ${iconClass} text-xl sm:text-2xl flex-shrink-0"></i>
        <div class="flex flex-col min-w-0">
          <span class="font-medium text-gray-700 truncate">${file.name}</span>
          <span class="text-xs text-gray-400">${file.size ? formatBytes(file.size) : ''} ${file.createdTime ? '• ' + new Date(file.createdTime).toLocaleDateString() : ''}</span>
        </div>
      </div>
      
      <div class="flex items-center gap-2 flex-shrink-0">
        <a href="${viewLink}" target="_blank" class="text-gray-500 hover:text-blue-600 p-2 rounded hover:bg-blue-50 transition-colors" title="Ko'rish">
          <i class="fa-solid fa-eye"></i>
        </a>
        <a href="${downloadLink}" target="_blank" class="text-gray-500 hover:text-green-600 p-2 rounded hover:bg-green-50 transition-colors" title="Yuklab olish">
          <i class="fa-solid fa-download"></i>
        </a>
      </div>
    `;
    filesList.appendChild(li);
  });

  // Checkbox logic
  const checkboxes = document.querySelectorAll('.file-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const checkedCount = document.querySelectorAll('.file-checkbox:checked').length;
      if (checkedCount > 0) {
        btnDeleteSelected.classList.remove('hidden');
        btnDeleteSelected.classList.add('flex');
        btnDeleteSelected.querySelector('span').textContent = `O'chirish (${checkedCount})`;
      } else {
        btnDeleteSelected.classList.add('hidden');
        btnDeleteSelected.classList.remove('flex');
      }
    });
  });
}

// Back Button
btnBack.onclick = () => {
  currentFolderId = null;
  currentUserId = null;
  filesView.classList.add('hidden');
  foldersView.classList.remove('hidden');
  // Parol holati tozalanadi (logout)
};

// Delete Selected
btnDeleteSelected.onclick = async () => {
  const checked = document.querySelectorAll('.file-checkbox:checked');
  if (checked.length === 0) return;

  if (!confirm('Tanlangan fayllarni o\'chirib tashlamoqchimisiz?')) return;

  const ids = Array.from(checked).map(cb => cb.dataset.id);

  try {
    setLoader(true);
    await deleteFiles(ids);
    showToast("Fayllar muvaffaqiyatli o'chirildi!", false);
    await loadFiles();
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoader(false);
  }
};

// Upload Files
fileUpload.onchange = async (e) => {
  const files = e.target.files;
  if (!files.length) return;

  try {
    setLoader(true);
    await uploadFiles(currentFolderId, files);
    showToast("Fayl(lar) muvaffaqiyatli yuklandi!", false);
    await loadFiles();
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoader(false);
    fileUpload.value = ''; // Reset input
  }
};

// Start
document.addEventListener('DOMContentLoaded', init);
