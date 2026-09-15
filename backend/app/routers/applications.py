from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Application, EssayQuestion, Match, User
from app.routers.essay_questions import question_list_item
from app.schemas import ApplicationCreate, ApplicationDetail, ApplicationOut, ApplicationUpdate
from app.security import get_current_user

router = APIRouter(prefix="/applications", tags=["applications"])


def _get_owned_application(application_id: int, current_user: User, db: Session) -> Application:
    application = db.get(Application, application_id)
    if application is None or application.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return application


def _question_count(application: Application, db: Session) -> int:
    return db.query(func.count(EssayQuestion.id)).filter(EssayQuestion.application_id == application.id).scalar() or 0


def _out(application: Application, question_count: int) -> ApplicationOut:
    return ApplicationOut.model_validate(application).model_copy(update={"question_count": question_count})


@router.get("", response_model=list[ApplicationOut])
def list_applications(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Application, func.count(EssayQuestion.id))
        .outerjoin(EssayQuestion, EssayQuestion.application_id == Application.id)
        .filter(Application.user_id == current_user.id)
        .group_by(Application.id)
        .order_by(Application.created_at.desc(), Application.id.desc())
        .all()
    )
    return [_out(application, count) for application, count in rows]


@router.post("", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    payload: ApplicationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    application = Application(
        user_id=current_user.id,
        company=payload.company,
        position=payload.position,
        job_description=payload.job_description,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return _out(application, 0)


@router.get("/{application_id}", response_model=ApplicationDetail)
def get_application(
    application_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    application = _get_owned_application(application_id, current_user, db)
    questions = (
        db.query(EssayQuestion)
        .filter(EssayQuestion.application_id == application.id)
        .order_by(EssayQuestion.created_at, EssayQuestion.id)
        .all()
    )
    return ApplicationDetail(
        **_out(application, len(questions)).model_dump(),
        questions=[question_list_item(q) for q in questions],
    )


@router.put("/{application_id}", response_model=ApplicationOut)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    application = _get_owned_application(application_id, current_user, db)

    # The job description feeds scoring for every question of this application, so
    # changing it makes their scores stale: drop them and let each question rematch
    # the next time its matches are viewed (the same lazy path a new question takes).
    # Company / position edits keep matches, including what the user had confirmed.
    job_description_changed = (application.job_description or None) != (payload.job_description or None)

    application.company = payload.company
    application.position = payload.position
    application.job_description = payload.job_description

    if job_description_changed:
        question_ids = db.query(EssayQuestion.id).filter(EssayQuestion.application_id == application.id)
        db.query(Match).filter(Match.essay_question_id.in_(question_ids.scalar_subquery())).delete(
            synchronize_session=False
        )

    db.commit()
    db.refresh(application)
    return _out(application, _question_count(application, db))


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(
    application_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    application = _get_owned_application(application_id, current_user, db)
    db.delete(application)  # cascades to its questions and their matches (relationship cascade)
    db.commit()
    return None
