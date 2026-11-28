// History holds only opaque entry IDs. Account credentials and return positions stay in this tab.
const publicViews = [];

history.scrollRestoration = 'manual';

function publicReturnPosition(button) {
    return {
        key:button?.dataset.browseKey,
        top:button?.getBoundingClientRect().top,
        scroll:window.scrollY
    };
}

function restorePublicPosition(position) {
    if (!position) return;
    const button = [...document.querySelectorAll('[data-browse-key]')].find(element =>
        element.dataset.browseKey === position.key && element.getClientRects().length);
    const top = button && position.top != null
        ? window.scrollY + button.getBoundingClientRect().top - position.top
        : position.scroll;
    window.scrollTo({top, behavior:'instant'});
    button?.focus({preventScroll:true});
}

function enterPublicView(leave, position) {
    const id = crypto.randomUUID();
    history.pushState({abhiEntry:id}, '');
    publicViews.push({id, leave, position});
}

function leavePublicView() {
    const view = publicViews.pop();
    if (!view) return false;
    view.leave();
    restorePublicPosition(view.position);
    if (history.state?.abhiEntry === view.id) history.back();
    return true;
}

function resetPublicViews() {
    if (!publicViews.length) return;
    const depth = publicViews.length;
    publicViews.length = 0;
    history.go(-depth);
}

window.addEventListener('popstate', event => {
    const current = publicViews.at(-1);
    if (!current || current.id === event.state?.abhiEntry) return;
    // A device Back gesture dismisses the top sheet before leaving the account beneath it.
    const sheet = document.querySelector('#upiReferenceOverlay') ||
        document.querySelector('#publicLoanDetailOverlay, #abhiBorrowerDuesOverlay');
    if (sheet && accountAccess) {
        history.pushState({abhiEntry:current.id}, '');
        if (sheet.id === 'upiReferenceOverlay') sheet.querySelector('.upi-ref-cancel')?.click();
        else if (sheet.id === 'publicLoanDetailOverlay') window.publicCloseLoanCompactDetail();
        else window.publicCloseBorrowerDues();
        return;
    }
    while (publicViews.length && publicViews.at(-1).id !== event.state?.abhiEntry) {
        const view = publicViews.pop();
        view.leave();
        restorePublicPosition(view.position);
    }
});
