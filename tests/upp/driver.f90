! Runs NCEP UPP calwxt_bourg_post on layer profiles read from stdin.
! Input: ncase; per case: lm; lm lines "t(K) pmid(Pa)" top->bottom; lm+1 lines "pint(Pa) zint(m)" top->bottom.
! Output per case: "C k c1..c8" (ptype from 8 seeds), then " E areape areane surfw tlmhk" from the energy copy.
program upp_bourg_driver
  implicit none
  integer :: nc, k, lm, l, s
  real, allocatable :: t(:,:,:), q(:,:,:), pmid(:,:,:), pint(:,:,:), zint(:,:,:)
  real :: lmh(1,1), prec(1,1)
  integer :: ptype(1,1), cats(8)
  real, parameter :: g = 9.80665, pthresh = 0.0
  read(*,*) nc
  do k = 1, nc
    read(*,*) lm
    allocate(t(1,1,lm), q(1,1,lm), pmid(1,1,lm), pint(1,1,lm+1), zint(1,1,lm+1))
    do l = 1, lm
      read(*,*) t(1,1,l), pmid(1,1,l)
    end do
    do l = 1, lm+1
      read(*,*) pint(1,1,l), zint(1,1,l)
    end do
    q = 0.001
    lmh = real(lm)
    prec = 0.01
    do s = 1, 8
      call calwxt_bourg_post(1,1,1,1,1,1,1,1,1,1,lm,lm+1,s*7919,g,pthresh,t,q,pmid,pint,lmh,prec,zint,ptype,0)
      cats(s) = ptype(1,1)
    end do
    write(*,'(a,i6,8i3)') 'C ', k, cats
    call calwxt_bourg_energy(1,1,1,1,1,1,1,1,1,1,lm,lm+1,7919,g,pthresh,t,q,pmid,pint,lmh,prec,zint,ptype,0)
    deallocate(t, q, pmid, pint, zint)
  end do
end program upp_bourg_driver
